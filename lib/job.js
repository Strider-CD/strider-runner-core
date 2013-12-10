var _ = require('lodash')
  , spawn = require('child_process').spawn
  , async = require('async')
  , shellParse = require('shell-quote').parse
  , shellQuote = require('shell-quote').quote
  , colorize = require('./colorize')
  , text = require('../locales/en.json')
  , PHASES = ['environment', 'prepare', 'test', 'deploy', 'cleanup']

function exitError(command, code) {
  var e = new Error('Command "' + command + ' failed with code: ' + code)
  e.type = 'exitCode'
  e.code = code
  return e
}

function sum(list) {
  return list.reduce(function (a, b) { return a + b }, 0)
}

function runPlugin(phase, plugin, context, done) {
  if (!plugin[phase]) return done()
  if ('function' === typeof plugin[phase]) {
    return plugin[phase](context, done)
  }
  context.cmd(plugin[phase], function (code) {
    var data = {}
    data[phase + 'Cmd'] = code ? 'failed' : 'passed'
    context.data(data, 'extend')
    done(code && exitError(code), true)
  })
}

module.exports = Job

// config:
// - baseDir - the directory to work in. The code gets cloned to baseDir/code
// - io - eventemitter for sending job status events
// - logger
// - log
// - error
// - pty
function Job(job, provider, plugins, config) {
  this.config = _.extend({
    pty: false,
    env: {},
    logger: console
  }, config)
  if (this.config.pty) {
    this.config.logger.warn('PTY has been disabled due to a bug in node core');
    this.config.pty = false;
  }
  this.io = config.io
  this.job = job
  this.id = job._id
  this.provider = provider
  this.plugins = plugins
  this.logPrefix = colorize.job(this.id)
  this.phase = null
  this.testcode = null
  this.cancelled = false
  this.commands = []
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

    // If the plugin has a listen function, execute it
    this.plugins.forEach(function (plugin) {
      if (plugin.listen) {
        var context = self.pluginContext(self.provider.id, _.cloneDeep(self.config.env), [])
        plugin.listen(self.io, context)
      }
    })

    if (this.job.fromStriderJson) {
      this.comment('Config merged from strider.json')
    }

    dom.on('error', function (err) {
      self.log('domain error caught', err.message, err.stack)
      self.error(err)
      dom.dispose()
      self.done(err, done)
    })
    dom.run(function () {
      self.phase = PHASES[0]
      self.runPhase(done)
    })
  },
  cancel: function () {
    if (this.cancelled) return
    var self = this
    console.log('cancelling')
    this.cancelled = true
    if (!this.commands.length) {
      return self.io.emit('job.cancelled', self.id)
    }
    this.commands.forEach(function (cmd) {
      console.log('killing', cmd.cmd.command)
      cmd.proc.kill()
    })
    setTimeout(function () {
      self.io.emit('job.cancelled', self.id)
    }, 1000)
  },
  // private api
  listen: function () {
    var self = this
    this.io.on('job.cancel', function (id) {
      console.log('io cancel', id, self.id)
      if (self.id.toString() === id.toString()) {
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

  comment: function (text, plugin) {
    this.status('command.comment', { comment: text, plugin: plugin, time: new Date() })
  },

  /* usage:   (cmd, [plugin,] next) -> next(exitCode)
   * or:      (options, [plugin,] next) -> next(exitCode)
   *
   * plugin:  the name of the plugin that intiated the command
   *
   * options:
   *     cmd: string or {command: str, args: [], screen: str}
   *     silent: don't status the output as it goes
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
    var self = this
      , start = new Date()
      , options =
        { cwd: this.phase === 'environment' ? this.config.baseDir : this.config.dataDir
        , silent: false
        , detached: true
        }
      , std =
        { out: ''
        , err: ''
        }
      , proc

    cmd = processCmd(cmd, options)

    try {
      proc = spawn(cmd.command, cmd.args, options)
    } catch (e) {
      return next(127, '', 'Command not found')
    }
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')

    proc.stdout.on('data', function(buf) {
      if (!options.silent) self.status('stdout', buf)
      std.out += buf
    })

    proc.stderr.on('data', function(buf) {
      if (!options.silent) self.status('stderr', buf)
      std.err += buf
    })

    proc.on('close', function(exitCode) {
      var end = new Date()
        , elapsed = end.getTime() - start.getTime()
      // Uncomment to monitor job commands
      // self.log(util.format('command done %s %s; exit code %s; duration %s',
      // cmd.command, cmd.args, exitCode, elapsed))
      self.status('command.done', { exitCode: exitCode, time: end, elapsed: elapsed })
      var ind = -1
      for (var i=0; i<self.commands.length; i++) {
        if (self.commands[i].proc === proc) {
          ind = i
          break;
        }
      }
      if (ind !== -1) self.commands.splice(ind, 1)
      next(exitCode, std.out, std.err)
    })
    proc.on('error', function() {
      // prevent node from throwing an error
    })

    var strCmd = shellQuote([cmd.command].concat(cmd.args))
      , display = cmd.screen || strCmd
    this.status('command.start', { command: display, started: start, plugin: plugin, time: start })
    if (options.silent) {
      this.status('stdout', '[output suppressed]')
    }
    this.commands.push({
      cmd: { command: display, started: start, plugin: plugin, time: start },
      proc: proc
    })
    return proc;
  },

  // job running stuff
  pluginContext: function (pluginName, env, path) {
    var self = this
    var context = {
      status: this.status.bind(this),
      out: this.out.bind(this),

      log: function () {
        var args = [].slice.call(arguments)
        // TODO colorize the plugin name?
        return self.log.apply(self, [pluginName].concat(args))
      },

      comment: function (text) {
        self.comment(text, pluginName)
      },
      cmd: function (cmd, next) {
        if (typeof(cmd) === 'string' || cmd.command) {
          cmd = {cmd: cmd}
        }
        cmd.env = _.extend({}, env, {
          PATH: path.join(':') + ':' + process.env.PATH,
          HOME: process.env.HOME,
          LANG: process.env.LANG,
          PAAS_NAME: 'strider'
        }, cmd.env || {})
        return self.cmd(cmd, pluginName, next)
      },

      // update pluginData
      data: function (data, method, path) {
        self.status('plugin-data', {plugin: pluginName, data: data, method: method, path: path})
      },

      logger: this.config.logger,
      dataDir: this.config.dataDir,
      baseDir: this.config.baseDir,
      cacheDir: this.config.cacheDir,
      cachier: this.config.cachier(pluginName),
      io: this.io,

      plugin: pluginName,
      phase: this.phase,
      job: this.job,
      branch: this.job.ref.branch,
      project: this.project
    }
    return context
  },

  // collect `env` from all plugins for the current phase, and execute
  // plugin.runPhase(context) for each plugin in series
  runPhase: function (next) {
    if (this.cancelled) return
    var tasks = []
      , started = new Date()
      , self = this
      , path = []
      , env = _.cloneDeep(this.config.env)
    // need to clone the repo first
    if (this.phase === 'prepare') {
      tasks.push(this.provider.fetch.bind(this.provider, self.pluginContext(this.provider.id, env, path)))
    }
    this.plugins.forEach(function (plugin) {
      // all plugins will get the final, fully populated env object
      _.extend(env, ('function' === typeof plugin.env) ? plugin.env(self.phase) : plugin.env)
      if ('string' === typeof plugin.path) path.push(plugin.path)
      else path = path.concat('function' === typeof plugin.path ? plugin.path(self.phase) : plugin.path)
      tasks.push(function (next) {
        runPlugin(self.phase, plugin, self.pluginContext(plugin.id, env, path), next)
      })
    })
    async.series(tasks, this.phaseDone.bind(this, next, started))
  },


  // called on the completion (or erroring) of a phase
  phaseDone: function (next, started, err, actuallyRan) {
    /* jshint maxcomplexity: 11 */
    var code = 0
      , now = new Date()
    if (err) {
      if (err.type === 'exitCode') code = err.code
      if ('number' === typeof err) code = err
      if (code === 0) {
        this.error(err)
        return this.done(err, next)
      }
    }
    // Complain if no plugins actually did anything during testing?
    // XXX: should this be a fail hard?
    if (['deploy', 'test'].indexOf(this.phase) !== -1 && sum(actuallyRan) === 0) {
      this.out('Phase ' + this.phase + ' didn\'t actually run anything. Check your plugin configuration', 'warn')
    }
    if (this.phase === 'test') {
      this.status('tested', { time: now, exitCode: code })
    }
    if (this.phase === 'deploy') {
      this.status('deployed', { time: now, exitCode: code })
    }
    var nextPhase = PHASES[PHASES.indexOf(this.phase) + 1]
    if (code !== 0) {
      nextPhase = 'cleanup'
    } else if (nextPhase === 'deploy' && this.job.type !== 'TEST_AND_DEPLOY') {
      nextPhase = 'cleanup'
    }
    this.status('phase.done', {
      phase: this.phase,
      time: now,
      exitCode: code,
      next: nextPhase,
      elapsed: now.getTime() - started.getTime()
    })
    if (this.phase === 'cleanup') {
      return this.done(null, next)
    }
    this.phase = nextPhase
    this.runPhase(next)
  },

  // io stuff
  log: function () {
    var args = [].slice.call(arguments)
    this.config.log.apply(null, [this.logPrefix].concat(args))
  },
  error: function (error, serverOnly) {
    this.config.error(this.logPrefix, error.message || error, error.stack);
    if (!serverOnly) {
      this.status('stderr', text.errorPleaseReport + '\n\n' + error.message + '\n\n' + error.stack)
    }
  },
  status: function (type) {
    if (this.cancelled) return false
    var args = [].slice.call(arguments, 1)
    this.io.emit.apply(this.io, ['job.status.' + type, this.id].concat(args))
  },
  out: function (text, type) {
    var dest = ['error', 'stderr', 'warn'].indexOf(type) !== -1 ? 'stderr' : 'stdout'
    text = (type && colorize[type]) ? colorize[type](text) : text
    this.status(dest, text)
  }
}

function processCmd(cmd, options) {
  if (cmd.cmd) {
    _.extend(options, cmd)
    cmd = options.cmd;
    delete options.cmd
  }
  if (typeof(cmd) === 'string') {
    cmd = {
      command: cmd
    }
  }
  if (typeof(cmd.args) === 'undefined') {
    cmd.args = shellParse(cmd.command)
    cmd.command = cmd.args.shift()
  }
  return cmd
}
