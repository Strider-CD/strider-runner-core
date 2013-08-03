
var pty = require('./pty')
  , gitane = require('gitane')
  , spawn = require('child_process').spawn
  , _ = require('lodash')

module.exports = {
  git: git,
  run: run,
  runPty: runPty,
  runSimple: runSimple,
  shellWrap: shellWrap,
  shellUnwrap: shellUnwrap
}

function git(io, cwd, key, command, next) {
  var options
  if (arguments.length === 2) {
    options = io
    next = cwd
  } else {
    options = {
      io: io,
      cwd: cwd,
      command: command,
      privKey: key
    }
  }
  if (options.privKey) {
    if (options.screencmd !== false) {
      options.io.emit('stdout', options.screencmd || options.command, 'command')
    }
    gitane.run({
      emitter: options.io,
      baseDir: options.cwd,
      cmd: options.command,
      privKey: options.privKey,
      // not yet supported by gitane
      pty: options.pty,
      detached: true
    }, next)
  } else {
    run(options, next)
  }
}

function shellWrap(cmd) {
  return {
    cmd: 'sh',
    args: ['-c', cmd]
  }
}

function shellUnwrap(cmd, args) {
  if (cmd === 'sh' && args.length === 2 && args[0] === '-c') {
    cmd = args[1]
  } else {
    cmd += ' ' + args.join(' ')
  }
  return cmd
}

// run(io, cwd, command, next)
// [or]
// run(options, next)
//   {
//     io
//     cwd
//     command
//     pty [true]
//     args : list of arguments. Absence of this causes command to be treated as a shell command
//     screencmd : sanitized version of the command to display
//     env : {} ENV vbls
//   }
// If pty is true and forkpty(3) fails at a system level, a "disablepty" event is fired on io, and
// the command is executed using a normal child process
function run(io, cwd, command, next) {
  var options
  if (arguments.length === 2) {
    options = _.extend({
      pty: true,
      env: {}
    }, io)
    next = cwd
  } else {
    options = {
      io: io,
      cwd: cwd,
      command: command,
      pty: true
    }
  }
  options.io.emit('log', 'running command', options.command, options.args)

  if (options.pty) {
    options.command = shellUnwrap(options.command, options.args || [])
    try {
      return runPty(options, next)
    } catch (err) {
      if (err.message.indexOf('forkpty(3) failed') === -1) {
        console.log(err, options)
        options.io.emit('error', err)
        return next(1)
      }
    }
    options.io.emit('disablepty')
    options.args = null
  }

  if (!options.args) {
    options.args = ['-c', options.command]
    options.command = 'sh'
  }
  try {
    return runSimple(options, next)
  } catch (err) {
    options.io.emit('error', err)
    return next(1)
  }
}

function runSimple(io, cwd, command, args, next) {
  var screencmd = null
    , env = {}
  if (arguments.length === 2) {
    next = cwd
    screencmd = io.screencmd
    command = io.command
    args = io.args
    cwd = io.cwd
    env = io.env
    io = io.io
  }
  if (screencmd !== false) {
    io.emit('stdout', screencmd || shellUnwrap(command, args), 'command')
  }

  var proc = spawn(command, args || [], {
    cwd: cwd,
    env: env,
    detached: true
  })

  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  var sout = ''
    , serr = ''

  proc.stdout.on('data', function(buf) {
    io.emit('stdout', buf)
    sout += buf
  })

  proc.stderr.on('data', function(buf) {
    io.emit('stderr', buf)
    serr += buf
  })

  proc.on('close', function(exitCode) {
    io.emit('log', 'done with', command, args, exitCode)
    next(exitCode, sout, serr)
  })
  return proc
}

function runPty(io, cwd, command, next) {
  var options
  if (arguments.length === 2) {
    options = io
    next = cwd
    io = options.io
    command = options.command
  } else {
    options = {
      cwd: cwd,
      env: {}
    }
  }
  options = _.extend({
    name: 'xterm-color',
    cols: 500,
    rows: 50
  }, options)
  var proc = pty.spawn(command, options, next)
  var first = true
  proc.on('data', function (buf) {
    // the first output is just a regurgitation of the input
    if (first) {
      first = false
      if (options.screencmd !== false) {
        io.emit('stdout', options.screencmd || buf, 'command')
      }
      return
    }
    // XXX keep track of per-process output.... somehow
    io.emit('stdout', buf)
  })
  return proc
}

