
var async = require('async')
  , gumshoe = require('gumshoe')
  , heroku = require('./heroku')

var TEST_ONLY = "TEST_ONLY"
var TEST_AND_DEPLOY = "TEST_AND_DEPLOY"

module.exports = {
  getUrls: getUrls,
  processDetectionRules: processDetectionRules,
  getHookFn: getHookFn,
  makeHook: makeHook,
  collectPhases: collectPhases,
  processPhases: processPhases
}

function getUrls(url, ssh_key, api_key) {
  var screen
  if (ssh_key) {
    return [url, url]
  }
  url = url.replace(':', '/').slice('git@'.length)
  screen = url
  if (api_key) {
    // use the oauth api key with a blank password
    url = api_key + ':@' + url
    screen = '[github oauth key]@' + screen
  }
  return ['https://' + url, 'https://' + screen]
}

// Pre-process detection rules - some can have properties which are async functions
function processDetectionRules(rules, ctx, cb) {
  // filename property of detection rules can be a function
  var processedRules = []
  var fileRules = []
  rules.forEach(function(rule) {
    if (rule.filename && typeof(rule.filename) == 'function') {
      fileRules.push(function(cb) {
        rule.filename(ctx, function(err, result) {
          if (err) return cb(err, {rule: rule, filename: null})
          return cb(null, {rule: rule, filename: result})
        })
      })
      return
    } 
    processedRules.push(rule)
  })

  async.parallel(fileRules, function(err, results) {
    if (err) return cb(err, null)

    results.forEach(function(res) {
      res.rule.filename = res.filename
      processedRules.push(res.rule)
    })
    cb(null, processedRules)
  })
}

function makeHook(context, results, phase) {
  var hook = getHookFn(results[phase])
  if (!hook) return false
  return function(cb) {
    hook(context, function(hookExitCode, tasks) {
      // logger.debug("hook for phase %s complete with code %s", phase, hookExitCode)
      // Cleanup hooks can't fail
      if (phase !== 'cleanup' && hookExitCode) {
        return cb({phase: phase, code: hookExitCode, tasks: tasks}, false)
      }
      cb(null, {phase: phase, code: hookExitCode, tasks: tasks})
    })
  }
}

// returns a function of the signature (context, next) -> next(code, [data])
// The returned function expects context to contain at least:
//   - workingDir
//   - shellWrap
//   - forkProc
function getHookFn(hook) {
  // If actions are strings, we assume they are shell commands and try to execute them
  // directly ourselves.
  if (typeof(hook) === 'string') {
    return function(context, next) {
      // logger.debug("running shell command hook for phase %s: %s", phase, result[phase])
      var psh = context.shellWrap(hook)
      context.forkProc(context.workingDir, psh.cmd, psh.args, function (exitCode, sout, serr) {
        next(exitCode)
      })
    }
  }

  // Execution actions may be delegated to functions.
  // This is useful for example for multi-step things like in Python
  // where a virtual env must be set up.
  // Functions are of signature function(context, cb)
  // We assume the function handles any necessary shell interaction
  // and sending of update messages.
  if (typeof(hook) === 'function') {
    // XXX ?? why do we wrap this ??
    return function(ctx, cb) {
      // logger.debug("running function hook for phase %s", phase)
      hook(ctx, cb)
    }
  }

  // if it's not a string or a function, fail.
  if (hook) {
    return false
  }

  return function(context, cb) {
    // logger.debug("running NO-OP hook for phase: %s", phase)
    cb(0)
  }
}

function collectPhases(done, context, rules, cb) {
  context.io.emit('log', 'collecting phases')
  processDetectionRules(rules, context, function (err, rules) {
    if (err) {
      context.io.emit('error', err, 'Failed to processs plugin detection rules')
      return done(500)
    }
    gumshoe.run(context.workingDir, rules, cb)
  })
}

function herokuTask(context, phase) {
  return function(cb) {
    context.striderMessage("Deploying to Heroku ...")
    // logger.debug("running Heroku deploy hook")
    // XXX will fail
    heroku.deploy(
      context.io, context.workingDir, context.jobData.deploy_config.app,
      context.jobData.deploy_config.privkey, function(herokuDeployExitCode) {
        if (herokuDeployExitCode !== 0) {
          return cb({phase: phase, code: herokuDeployExitCode}, false)
        }
        cb(null, {phase: phase, code: herokuDeployExitCode})
      }
    )
  }
}

function processPhases(done, buildHooks, context, results) {
    var phases = ['prepare', 'test', 'deploy', 'cleanup']
      , runPhase = {}
      , runList = []

    if (!results) results = []

    // mod the path
    if (!context.env) context.env = {}
    var paths = context.env.PATH ? [context.env.PATH] : [process.env.PATH]
    results.forEach(function (result) {
      if (!result.path) return
      if (typeof(result.path) === 'string') {
        paths.unshift(result.path)
      } else if (Array.isArray(result.path)) {
        paths = paths.concat(result.path)
      }
    })
    context.env.PATH = paths.join(':')

    phases.forEach(function (phase) {
      if (context.jobData.job_type === TEST_ONLY && phase === 'deploy') {
        context.io.emit('log', 'skipping deploy phase; test run')
        return;
      }
      runPhase[phase] = function (next) {
        context.io.emit('log', 'Running phase', phase)
        var tasks = []
        var failed = results.concat(buildHooks).some(function (result) {
          var hookWrapper = makeHook(context, result, phase)
          if (!hookWrapper) {
            next(new Error('Invalid hook found for phase %s; %s', phase, result[phase]))
            return true
          }
          tasks.push(hookWrapper)
        })
        if (failed) return

        // If this job has a Heroku deploy config attached, add a single Heroku deploy function
        if (phase === 'deploy' && context.jobData.deploy_config) {
          // logger.log("have heroku config - adding heroku deploy build hook")
          tasks.push(herokuTask(context, phase))
        }

        async.series(tasks, function(err, results) {
          context.io.emit('log', 'Done with phase', phase, err)
          next(err, results)
        })
      }
      runList.push(runPhase[phase])
    })
    async.series(runList, function(err, results) {
      context.io.emit('log', 'finished with all phases')
      // logger.log("results: %j", results)
      var tasks = []
      // make sure we run cleanup phase
      if (err && err.phase !== 'cleanup') {
        // logger.debug("Failure in phase %s, running cleanup and failing build", err.phase)
        return runPhase['cleanup'](function(e) {
          done(err.code, err.tasks)
        })
      }
      results.forEach(function(r) {
        r.forEach(function(tr) {
          if (tr.tasks && Array.isArray(tr.tasks)) {
            tasks = tr.tasks.concat(tasks)
          } else if (tr.tasks && typeof(tr.tasks) === 'object') {
            tasks.push(tr.tasks)
          }
        })
      })
      return done(0, tasks)
    })
}
