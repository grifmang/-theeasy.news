const {startService} = require('./bootstrap');

module.exports = {startService};
if (require.main === module) {
  startService().then(service=>{
    console.log('Server listening on port',service.server.address().port);
    const shutdown=()=>service.stop().catch(()=>{process.exitCode=1;});
    process.once('SIGTERM',shutdown);
    process.once('SIGINT',shutdown);
  }).catch(error=>{
    console.error('Server startup failed:',error.message);
    process.exitCode=1;
  });
}
