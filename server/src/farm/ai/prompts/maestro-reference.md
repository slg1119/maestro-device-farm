# Maestro 2.x concise command reference

Examples are command fragments following a flow's `---` separator. Replace example
packages, selectors, paths, and environment variable names with workspace values.

## Flow configuration
```yaml
appId: com.example.app
name: Login
tags: [smoke]
env:
  USERNAME: ${TEST_USERNAME}
onFlowStart:
  - launchApp
onFlowComplete:
  - stopApp
---
- assertVisible: Home
```

Workspace `config.yaml` selects flows and tags:
```yaml
flows:
  - "flows/**"
includeTags: [smoke]
excludeTags: [disabled]
```

## launchApp
```yaml
- launchApp:
    appId: com.example.app
    clearState: true
    stopApp: true
    permissions:
      all: allow
    arguments:
      testMode: true
```

## tapOn, doubleTapOn, longPressOn
Selectors support text, id, index, point, enabled, childOf, below, above,
leftOf, and rightOf. Prefer a stable id and omit unnecessary conditions.
```yaml
- tapOn:
    id: submit
    text: Continue
    index: 0
    enabled: true
    childOf:
      id: login_form
    below:
      id: username
    above:
      id: footer
    rightOf:
      id: cancel
    leftOf:
      id: help
    retryTapIfNoChange: true
    optional: false
- doubleTapOn:
    text: Photo
- longPressOn:
    point: "50%,50%"
```

## inputText
```yaml
- inputText: ${TEST_USERNAME}
```

## inputRandomEmail, inputRandomNumber, inputRandomPersonName, inputRandomText
```yaml
- inputRandomEmail
- inputRandomNumber:
    length: 6
- inputRandomPersonName
- inputRandomText:
    length: 12
```

## eraseText
```yaml
- eraseText: 20
```

## pressKey
```yaml
- pressKey: Enter
```

## back
```yaml
- back
```

## hideKeyboard
```yaml
- hideKeyboard
```

## scroll
```yaml
- scroll
```

## scrollUntilVisible
```yaml
- scrollUntilVisible:
    element:
      id: booking_button
    direction: DOWN
    timeout: 15000
    centerElement: true
```

## swipe
Direction, start/end, and from are alternative ways to specify the gesture.
```yaml
- swipe:
    direction: UP
- swipe:
    start: "50%,80%"
    end: "50%,20%"
- swipe:
    from:
      id: carousel
    direction: LEFT
```

## assertVisible
```yaml
- assertVisible:
    id: home_title
```

## assertNotVisible
```yaml
- assertNotVisible: Loading
```

## assertTrue
```yaml
- assertTrue: ${output.ready == true}
```

## extendedWaitUntil
```yaml
- extendedWaitUntil:
    visible:
      id: home_title
    timeout: 30000
```

## waitForAnimationToEnd
```yaml
- waitForAnimationToEnd:
    timeout: 5000
```

## takeScreenshot
```yaml
- takeScreenshot: screenshots/home
```

## copyTextFrom
```yaml
- copyTextFrom:
    id: confirmation_code
```

## pasteText
```yaml
- pasteText
```

## openLink
```yaml
- openLink: example://home
```

## runFlow
Reuse a file or inline commands. `when` is optional and `env` overrides subflow variables.
```yaml
- runFlow:
    file: subflows/login.yaml
    when:
      visible: Sign in
    env:
      USERNAME: ${TEST_USERNAME}
- runFlow:
    when:
      visible: Dismiss
    commands:
      - tapOn: Dismiss
```

## runScript
```yaml
- runScript:
    file: scripts/prepare.js
    env:
      REGION: seoul
```

## evalScript
```yaml
- evalScript: ${output.ready = true}
```

## repeat
`times` and `while` are alternatives; choose a bounded loop when possible.
```yaml
- repeat:
    times: 3
    commands:
      - scroll
- repeat:
    while:
      visible: Load more
    commands:
      - tapOn: Load more
```

## retry
```yaml
- retry:
    maxRetries: 2
    commands:
      - assertVisible: Ready
```

## clearState
```yaml
- clearState: com.example.app
```

## stopApp
```yaml
- stopApp: com.example.app
```

## killApp
```yaml
- killApp: com.example.app
```

## setLocation
```yaml
- setLocation:
    latitude: 37.5665
    longitude: 126.9780
```

## addMedia
```yaml
- addMedia:
    - media/example.png
```
