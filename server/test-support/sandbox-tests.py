"""Linux-only native isolation tests with disposable, synthetic fixtures."""
import os
from pathlib import Path
import signal
import socket
import json
import hashlib
import shutil
import subprocess
import tarfile
import tempfile
import unittest

SERVER = Path(__file__).resolve().parents[1]


class SandboxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.area = tempfile.TemporaryDirectory(prefix="easy-sandbox-tests-")
        cls.root = Path(cls.area.name)
        cls.runtime = cls.root / "runtime"
        cls.runtime.mkdir()
        cls.launcher = cls.root / "launcher"
        cls.worker = cls.runtime / "worker"
        for source, output, extra in [
            (SERVER / "evidence/native/parser-sandbox.c", cls.launcher, ["-lseccomp"]),
            (SERVER / "test-support/sandbox-adversary.c", cls.worker, ["-pthread"]),
        ]:
            subprocess.run(["cc", "-Wall", "-Wextra", "-Werror", str(source),
                            "-o", str(output), *extra], check=True, timeout=30)
        cls.private = cls.root / "private.txt"
        cls.private.write_text("synthetic private fixture")
        cls.readable = cls.runtime / "public.txt"
        cls.readable.write_text("synthetic runtime fixture")
        Path(str(cls.readable) + "-link").symlink_to(cls.private)

    @classmethod
    def tearDownClass(cls):
        cls.area.cleanup()

    def invoke(self, mode, runtime=None, sandbox=True):
        with tempfile.TemporaryDirectory(prefix="scratch-", dir=self.root) as scratch:
            descriptor = os.open(self.private, os.O_RDONLY)
            try:
                def expose_descriptor():
                    os.dup2(descriptor, 9, inheritable=True)
                prefix = [str(self.launcher), str(runtime or self.runtime), scratch] if sandbox else []
                return subprocess.run([*prefix,
                    str(self.worker), mode, str(self.private), str(self.readable)
                ], input=b"", stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    env={**os.environ, "SANDBOX_TEST_SECRET": "do-not-inherit"},
                    close_fds=False, preexec_fn=expose_descriptor, timeout=8)
            finally:
                os.close(descriptor)

    def test_files_network_processes_environment_and_inherited_descriptors(self):
        result = self.invoke("checks")
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b"sandbox restrictions verified", result.stdout)

    def test_memory_allocation_is_bounded(self):
        self.assertEqual(self.invoke("memory").returncode, 0)

    def test_fixture_really_inherits_descriptor_and_environment_without_launcher(self):
        self.assertEqual(self.invoke("controlfd", sandbox=False).returncode, 0)

    def test_links_and_truncation_cannot_escape(self):
        result = self.invoke("links")
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(self.private.read_text(), "synthetic private fixture")

    def test_scratch_files_cannot_execute(self):
        self.assertEqual(self.invoke("scratch-exec").returncode, 0)

    def test_file_size_limit_is_enforced(self):
        self.assertEqual(self.invoke("file-limit").returncode, -signal.SIGXFSZ)

    def test_descriptor_count_is_bounded(self):
        self.assertEqual(self.invoke("fd-limit").returncode, 0)

    def test_regular_file_stdin_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="stdio-", dir=self.root) as scratch:
            with self.private.open("rb") as source:
                result = subprocess.run([str(self.launcher), str(self.runtime), scratch,
                    str(self.worker), "checks", str(self.private), str(self.readable)],
                    stdin=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertEqual(result.returncode, 125)

    def test_unnamed_unix_stdio_is_permitted_but_named_endpoint_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="socket-", dir=self.root) as scratch:
            for named in [False, True]:
                with self.subTest(named=named):
                    parent, child = socket.socketpair()
                    try:
                        if named:
                            child.bind(str(Path(scratch) / "named.sock"))
                        result = subprocess.run([str(self.launcher), str(self.runtime), scratch,
                            str(self.worker), "threads", str(self.private), str(self.readable)],
                            stdin=child, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                        self.assertEqual(result.returncode, 125 if named else 0, result.stderr.decode())
                    finally:
                        parent.close()
                        child.close()

    def test_network_socket_stdio_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="network-", dir=self.root) as scratch:
            with socket.socket() as listener, socket.socket() as client:
                listener.bind(("127.0.0.1", 0))
                listener.listen(1)
                client.connect(listener.getsockname())
                peer, _ = listener.accept()
                try:
                    result = subprocess.run([str(self.launcher), str(self.runtime), scratch,
                        str(self.worker), "threads", str(self.private), str(self.readable)],
                        stdin=client, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                    self.assertEqual(result.returncode, 125)
                finally:
                    peer.close()

    def test_overlapping_runtime_and_scratch_is_rejected(self):
        result = subprocess.run([str(self.launcher), str(self.runtime), str(self.runtime),
            str(self.worker), "checks", str(self.private), str(self.readable)],
            input=b"", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertEqual(result.returncode, 125)

    def test_runtime_threads_are_permitted(self):
        result = self.invoke("threads")
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_cpu_loop_is_killed(self):
        self.assertIn(self.invoke("cpu").returncode, [-signal.SIGXCPU, -signal.SIGKILL])

    def test_broad_runtime_root_is_rejected(self):
        self.assertEqual(self.invoke("checks", runtime="/").returncode, 125)

    @unittest.skipUnless(os.environ.get("EASY_PARSER_NODE_ARCHIVE"), "Linux Node archive required")
    def test_actual_html_parser(self):
        # Extract only the named executable, never arbitrary archive paths.
        node = self.runtime / "node"
        with tarfile.open(os.environ["EASY_PARSER_NODE_ARCHIVE"], "r:gz") as archive:
            member = archive.getmember("package/bin/node")
            self.assertTrue(member.isfile())
            with archive.extractfile(member) as source, node.open("wb") as target:
                shutil.copyfileobj(source, target)
        node.chmod(0o700)
        bundle = self.root / "packaged-bundle"
        packaging = "require(process.argv[1]).createParserBundle({destination:process.argv[2],nodeExecutable:process.argv[3],launcherExecutable:process.argv[4]})"
        packaged = subprocess.run([str(node), "-e", packaging,
            str(SERVER / "evidence/native/parser-bundle.js"), str(bundle), str(node), str(self.launcher)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        self.assertEqual(packaged.returncode, 0, packaged.stderr.decode())
        packaged_runtime = bundle / "runtime"
        openssl = packaged_runtime / "openssl.cnf"
        worker = packaged_runtime / "html-parser-worker.mjs"
        if os.environ.get("EASY_PARSER_DIAGNOSTICS"):
            worker.chmod(0o600)
            worker.write_text(worker.read_text().replace('catch {', 'catch (error) { console.error(error);'))
        with tempfile.TemporaryDirectory(prefix="node-scratch-", dir=self.root) as scratch:
            result = subprocess.run([str(bundle / "launcher"), str(packaged_runtime), scratch,
                str(packaged_runtime / "node"), "--openssl-config=" + str(openssl),
                "--jitless", "--no-expose-wasm", "--max-old-space-size=96",
                "--max-semi-space-size=4", str(worker)], input=b"<p>Verified synthetic text.</p>",
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        output = json.loads(result.stdout)
        self.assertEqual(output["text"].strip(), "Verified synthetic text.")
        self.assertTrue(output["quality"]["requiresReview"])
        application_scratch = self.root / "application-scratch"
        application_scratch.mkdir()
        wrapper_probe = "require(process.argv[1]).runHtmlWrapperProbe(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1})"
        checked = subprocess.run([str(node), "-e", wrapper_probe,
            str(SERVER / "test-support/html-wrapper-probe.js"), str(bundle), str(application_scratch)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        self.assertEqual(checked.returncode, 0, checked.stderr.decode())
        self.assertEqual(json.loads(checked.stdout)["cases"], 8)
        release = self.root / "release-bundle"
        digest_file = self.root / "release-bundle.sha256"
        command = [str(node), str(SERVER / "ops/build-parser-bundle.js"),
            str(release), str(self.launcher), str(digest_file)]
        built = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        self.assertEqual(built.returncode, 0, built.stderr.decode())
        self.assertEqual(digest_file.read_text().strip(), hashlib.sha256((release / "manifest.json").read_bytes()).hexdigest())

        for item in [release, *release.rglob("*")]:
            self.assertEqual(item.stat().st_mode & 0o222, 0, str(item))
            if item.is_dir():
                self.assertEqual(item.stat().st_mode & 0o555, 0o555)
        self.assertEqual(digest_file.stat().st_mode & 0o777, 0o444)
        self.assertTrue(os.access(release / "launcher", os.X_OK))
        self.assertTrue(os.access(release / "runtime/node", os.X_OK))
        sealed_probe = "require(process.argv[1]).extractHtml(Buffer.from('<p>Read-only release.</p>'),{bundleDirectory:process.argv[2],manifestSha256:require('fs').readFileSync(process.argv[3],'utf8').trim(),scratchParent:process.argv[4]}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1})"
        sealed = subprocess.run([str(node), "-e", sealed_probe, str(SERVER / "evidence/extract-html.js"),
            str(release), str(digest_file), str(application_scratch)], stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(sealed.returncode, 0, sealed.stderr.decode())
        self.assertEqual(json.loads(sealed.stdout)["text"], "Read-only release.\n")
        self.assertEqual(list(application_scratch.iterdir()), [])
        # A second build must preserve both existing release and trust record.
        again = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        self.assertNotEqual(again.returncode, 0)
        self.assertEqual(digest_file.read_text().strip(), hashlib.sha256((release / "manifest.json").read_bytes()).hexdigest())

        if os.geteuid() == 0:
            # Root is only the fixture owner. The probe launches the application
            # checker as UID/GID 1000 and verifies ownership/mode rejections.
            runtime_probe = "console.log(JSON.stringify(require(process.argv[1]).runRuntimeProbe(process.argv[2],process.argv[3],process.argv[4])))"
            checked_runtime = subprocess.run([str(node), "-e", runtime_probe,
                str(SERVER / "test-support/html-runtime-probe.js"), str(release),
                str(digest_file), str(application_scratch)], stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, timeout=45)
            self.assertEqual(checked_runtime.returncode, 0, checked_runtime.stderr.decode())
            self.assertEqual(json.loads(checked_runtime.stdout)["cases"], 12)


if __name__ == "__main__":
    unittest.main()
