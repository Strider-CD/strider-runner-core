
var _ = require('lodash')
  , EventEmitter = require('events').EventEmitter
  , spawn = require('child_process').spawn
  , path = require('path')
  , fs = require('fs')

  , async = require('async')
  , mkdirp = require('mkdirp')
  , shellParse = require('shell-quote').parse
  , shellQuote = require('shell-quote').quote

  , colorize = require('./colorize')

  , text = require('../locales/en.json')

var PHASES = ['environment', 'prepare', 'test', 'deploy', 'cleanup']

function sum(list) {
  return list.reduce(function (a, b) { return a + b }, 0)
}

function runPlugin(phase, plugin, context, done) {
  if (!plugin[phase]) return done()
  if ('string' !== typeof plugin[phase]) {
    return plugin[phase](context, done)
  }
  context.cmd(plugin[phase], function (err) {
    done(err, !err)
  })
}

module.exports = Job

// config:
// - dataDir - the directory where the code will live
// - io - eventemitter for sending job status events
function Job(job, provider, plugins, config) {
  this.config = _.extend({
    pty: false,
    logger: console
  }, config)
  if (this.config.pty) {
    this.config.logger.warn('PTY has been disabled due to a bug in node core');
    this.config.pty = false;
  }
  this.io = config.io
  this.job = job
  this.id = job.id
  this.provider = provider
  this.plugins = plugins
  this.logPrefix = colorize.job(this.id)
  this.phase = null
  this.testcode = null
  this.cancelled = false
  this.listen()
}

Job.prototype = {
  // public api
  run: function (done) {
    var self = this
      , dom = require('domain').create()

    // no plugins in use, nothing will happen. fail.
    if (!this.plugins.length) {
      return this.done({message: 'No plugins configured. Aborting'}, done)
    }

    dom.on('error', function (err) {
      self.log('domain error cought', err.message, err.stack)
      self.error(err)
      dom.dispose()
      self.done(err, done)
    })
    dom.run(function () {
      self.nextPhase(done)
    })
  },
  cancel: function () {
    this.cancelled = true
    this.io.emit('job.cancelled', this.id)
  },
  // private api
  listen: function () {
    var self = this
    this.io.on('job.cancel', function (id) {
      if (self.id === id) {
        self.cancel()
      }
    })
  },
  done: function (err, done) {
    if (this.cancelled) {
      this.log('"done" called but the job is cancelled. Not calling continuation')
      return
    }
    done(err)
  },

  // command execution stuff

  /* usage:   (cmd, [plugin,] next) -> next(exitCode)
   * or:      (options, [plugin,] next) -> next(exitCode)
   *
   * plugin:  the name of the plugin that intiated the command
   *
   * options:
   *     cmd: string or {command: str, args: [], screen: str}
   *     env: {}
   *     cwd: str
   *
   * cmd('echo "hey"', next)
   * cmd({command: 'echo secretpassword', screen: 'echo [pwd]'}, next)
   * cmd({command: 'echo', args: ['hello']}, next)
   * cmd({cmd: 'hey', env: {ONE: 2}}, next)
   */ 
  cmd: function (cmd, plugin, next) {
    if (arguments.length === 2) {
      next = plugin
      plugin = null
    }
    var parts
      , self = this
      , start = new Date()
    var options = {
      cwd: this.config.dataDir,
      detached: true
    }
    
    if (typeof(cmd) === 'string') {
      cmd = {
        command: cmd
      }
    } else if (cmd.cmd) {
      _.extend(options, cmd)
      cmd = options.cmd;
      delete options.cmd
    }
    if (typeof(cmd.args) === 'undefined') {
      cmd.args = shellParse(cmd.command)
      cmd.command = cmd.args.shift()
    }

    var proc = spawn(cmd.command, cmd.args, options)
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')

    proc.stdout.on('data', function(buf) {
      self.status('stdout', buf)
    })

    proc.stderr.on('data', function(buf) {
      self.status('stderr', buf)
    })

    proc.on('close', function(exitCode) {
      var end = new Date()
        , elapsed = end.getTime() - start.getTime()
      self.log('command done %s %s; exit code %s; duration %s', cmd.command, cmd.args, exitCode, elapsed)
      self.status('command.done', { exitCode: exitCode, time: end, elapsed: elapsed })
      next(exitCode)
    })

    var strCmd = shellQuote([cmd.command].concat(cmd.args))
      , display = cmd.screen || strCmd
    this.status('command.start', { command: display, started: start, plugin: plugin })
    return proc;
  },

  // job running stuff
  nextPhase: function (next) {
    if (this.cancelled) return
    if (this.phase === null) {
      this.phase = PHASES[0]
    } else {
      this.phase = PHASES[PHASES.indexOf(this.phase) + 1]
    }
    if (this.phase === 'deploy' && this.job.type !== 'TEST_AND_DEPLOY') {
      return this.nextPhase(next)
    }
    this.runPhase(next)
  },
  pluginContext: function (pluginName, env) {
    var self = this
    var context = {
      status: this.status.bind(this),
      out: this.out.bind(this),

      log: function () {
        var args = [].slice.call(arguments)
        // TODO colorize the plugin name?
        return self.log.apply(self, [pluginName].concat(args))
      },

      cmd: function (cmd, next) {
        if (typeof(cmd) === 'string' || cmd.command) {
          cmd = {cmd: cmd}
        }
        cmd.env = _.extend({}, env, cmd.env || {})
        return self.cmd(cmd, pluginName, next)
      },

      logger: this.config.logger,
      dataDir: this.config.dataDir,
      io: this.io,

      plugin: pluginName,
      phase: this.phase,
      job: this.job,
      project: this.project
    }
  },

  // collect `env` from all plugins for the current phase, and execute
  // plugin.runPhase(context) for each plugin in series
  runPhase: function (next) {
    if (this.cancelled) return
    var tasks = []
      , self = this
      , env = {}
      , provider
      , name
    // need to clone the repo first
    if (this.phase === 'prepare') {
      tasks.push(this.provider.fetch.bind(this.provider, self.pluginContext(this.provider.id, env)))
    }
    this.plugins.forEach(function (plugin) {
      // all plugins will get the final, fully populated env object
      if ('function' === typeof plugin.env) _.extend(env, plugin.env(self.phase))
      else if ('object' === typeof plugin.env) _.extend(env, plugin.env)
      tasks.push(function (next) {
        runPlugin(self.phase, plugin, self.pluginContext(plugin.name, env), next)
      })
    })
    async.series(tasks, this.phaseDone.bind(this, next))
  },

  // called on the completion (or erroring) of a phase
  phaseDone: function (next, err, actuallyRan) {
    var code = (err && err.type === 'exitCode') ? err.code : 0
      , now = new Date()
    if (err && code === 0) {
      this.error(err)
      return this.done(err, next)
    }
    this.status('phase.done', { phase: this.phase, time: now, exitCode: code })
    if (this.phase === 'cleanup') {
      return this.done(null, next)
    }
    if (code !== 0) {
      this.phase = 'cleanup'
      return this.runPhase(next)
    }
    // Complain if no plugins actually did anything during testing?
    // XXX: should this be a fail hard?
    if (['deploy', 'test'].indexOf(this.phase) !== -1 && sum(actuallyRan) === 0) {
      this.out('Phase ' + this.phase + " didn't actually run anything. Check your plugin configuration", 'warn')
    }
    if (this.phase === 'test') {
      this.status('tested', { time: now, exitCode: code })
    }
    if (this.phase === 'deploy') {
      this.status('deployed', { time: now, exitCode: code })
    }
    this.nextPhase(next)
  },

  // io stuff
  log: function () {
    var args = [].slice.call(arguments)
    this.config.log.apply(null, [this.logPrefix].concat(args))
  },
  error: function (error, serverOnly) {
    this.config.error(this.logPrefix, error.message, error.stack);
    if (!serverOnly) {
      this.status('stderr', text.error_please_report + '\n\n' + error.message + '\n\n' + error.stack)
    }
  },
  status: function (type) {
    if (this.cancelled) return false
    var args = [].slice.call(arguments)
    this.io.emit.apply(this.io, ['job.status.' + type, this.id].concat(args))
  },
  out: function (text, type) {
    var dest = ['error', 'stderr', 'warn'].indexOf(type) !== -1 ? 'stderr' : 'stdout'
    text = (type && colorize[type]) ? colorize[type](text) : text
    this.status(dest, text)
  }
}
