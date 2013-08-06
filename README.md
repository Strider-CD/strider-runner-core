strider-worker-core
===================

Just run those jobs. Decoupled from load balancing, job queues, etc.

# module.exports = runJob(job, io)

```js
var runJob = require('strider-worker-core');

runJob(job, io);
```

- io is an eventemitter. Job events will be emitted throughout the course of
  the job being run.
- job looks like:

```
- user_id
- repo: {
    url: github.com/jaredly/jared.git
    auth: {
      type: https
      username:
      password:
    } || {
      type: ssh
      key:
    }
    provider: github || bitbucket || gitlab
    vcs: git || hg
  }
- job_id
- ref: {
    branch:
    id:
  } || {
    fetch: "+refs/pull/141/merge"
  }
- job_type (TEST, DEPLOY, TEST&DEPLOY)
- trigger [see trigger spec below]

// stuff gotten from the DB & config file. Any branch-specific config
// is already factored in.
- plugins: [names, in, order]
- config {
    .. defined by the plugins ..
  }
```

#### Trigger spec

```
{
  type:
  author: {
    id: <strider uid>
    url: <ex: github.com/username>
    name: "Jared Forsyth"
    email: [optional]
    gravatar: [suggested]
    username: [only applicable for github, etc.]
  }
  message: [displayed in the ui]
  timestamp: [required]
  url: [message links here]
  source: {
    type: UI
    page: dashboard
  } || {
    type: API
    app: [app id? app name?]
  } || {
    type: plugin
    plugin: name
  }
}
```

### Events that are fired

#### command specific

```
- job:cmd:start  id, num, command, screencmd [sanitized version of command]
- job:cmd:done   id, num, exitCode
- job:cmd:stdout id, num, text
- job:cmd:stderr id, num, text
```

#### plugin specific

If a plugin wants to fire a custom event, it will use `job:plugin`.

```
- job:plugin     id, plugin, [whatever the plugin passes in]
```

#### general stdio

If the output doesn't come from a specific command.

```
- job:stdout     id, text
- job:stderr     id, text
```

#### status

```
- job:tested     id, code, timestamp
- job:deployed   id, code, timestamp
- job:done       id, timestamp
```
