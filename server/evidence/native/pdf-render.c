/* Fixed renderer dispatch inside the native sandbox; no inherited environment. */
#include <unistd.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
    (void)argc;
    char runtime[PATH_MAX], cwd[PATH_MAX], config[PATH_MAX+32];
    char executable[PATH_MAX], cache[PATH_MAX+32];
    if (!argv[0] || argv[0][0]!='/' || strlen(argv[0])>=sizeof(runtime)) return 125;
    strcpy(runtime,argv[0]);
    char *slash=strrchr(runtime,'/');
    if (!slash || slash==runtime) return 125;
    *slash='\0';
    if (!getcwd(cwd,sizeof(cwd))) return 125;
    if (snprintf(config,sizeof(config),"FONTCONFIG_FILE=%s/fonts.conf",runtime)>=(int)sizeof(config) ||
        snprintf(executable,sizeof(executable),"%s/pdftoppm",runtime)>=(int)sizeof(executable) ||
        snprintf(cache,sizeof(cache),"XDG_CACHE_HOME=%s",cwd)>=(int)sizeof(cache)) return 125;
    char *environment[]={"LANG=C.UTF-8",config,cache,NULL};
    argv[0]=executable;
    execve(executable,argv,environment);
    return 125;
}
