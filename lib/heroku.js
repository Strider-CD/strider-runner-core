
var gitane = require('gitane')

module.exports = {
  deploy: function (io, cwd, app, key, next) {
    // XXX this really should be in a plugin
    var cmd = 'git remote add heroku git@heroku.com:' + app + '.git'
    gitane.run({
      baseDir: cwd,
      privKey: key,
      cmd: cmd,
      emitter: io
    }, function (err) {
      if (err) {
        io.emit('stdout', 'Ignoring error adding remote', 'message')
      }
      gitane.run({
        baseDir: cwd,
        privKey: key,
        cmd: 'git push -f heroku master',
        emitter: io
      }, function (err) {
        if (err) {
          io.emit('stderr', 'Deployment to Heroku unsuccessful', 'error')
          return next(1)
        }
        io.emit('stdout', 'Deployment to Heroku successful', 'message')
        next(0)
      })
    })
  }
}
