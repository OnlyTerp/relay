# Contributing

PRs welcome. Keep it dependency-light.

```
cli/   relay command: runs agents in a pseudo-terminal, installs hooks, forwards events
app/   Electron app: hub (hub.js), dock + panel UI (ui/), settings, hotkeys, voice, phone link
```

- Run the hub alone: `cd app && node hub.js`, then open `http://127.0.0.1:7777/?token=<~/.relay/token>`.
- Run the app: `cd app && npm install && npm start`.
- Add an agent: if it has hooks, map its events in `cli/relay.js` (`hookMain`) to hub events
  `start | prompt | working | question | notify | stop | end`. Otherwise `relay <cmd>` already works via activity detection.
