
module.exports = function (command, args, options, done) {
  try {
    done(null, spawn(cmd.command, cmd.args, options))
  } catch (e) {
    done(127)
  }
}

/**
    try {
      proc = spawn(cmd.command, cmd.args, options)
    } catch (e) {
      return next(127, '', 'Command not found')
    }
    **/
