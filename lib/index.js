
var Job = require('./job')

module.exports = {
  process: process,
  Job: Job
}

// task: {job: data, repo: data}
// config vbls:
//   pty: bool
//   io: eventemiter
//   logger: {log: fn(), warn: fn(), error: fn(), info: fn()}
//   dataDir: str; where to store data
//   plugins: {name: init(config) -> {runPhase: fn(context, cb), getEnv: fn(phase)}, ...}
//     this can be a superset of the plugins actually used
//   providers: {name: obj, ...}
function process(data, provider, plugins, config, next) {
  var job = new Job(data, provider, plugins, config)
  return job.run(next)
}

