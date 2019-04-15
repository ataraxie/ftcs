# Successorships

You made it - welcome to a new age of fault-tolerant local Web apps!

## Setup

* Make sure you have current versions of Node and NPM installed
* Install a Flyweb-enabled Firefox Developer Edition. We went with version [50.0a2](https://download-origin.cdn.mozilla.net/pub/firefox/nightly/2016/08/2016-08-28-00-40-09-mozilla-aurora/firefox-50.0a2.en-US.mac.dmg
)
* Enable FlyWeb in Firefox
  * Go to about:config
  * Search for dom.flyweb.enabled and set it to true
* Optional for usability: you may also need to add the FlyWeb button to the toolbar
  * Burger menu => Customize => Drag FlyWeb item to menu bar
* Install the Shippy addon
  * Disable addon verification by setting xpinstall.signatures.required in about:config to false
  * Firefox burger menu => Add-ons => Extensions => Configuration dropdown => Install Add-on From File...
  * Select shippy-addon/shippy-addon.xpi

## Run the examples

* cd into any of the examples in shippy-examples/
* `npm install`
* `npm start`
* Go to http://localhost:3000 using the mentioned Firefox version
* Open the URL shown in the applications in multiple tabs to see how multiple clients behave
* Close the first tab and another client will become the server
