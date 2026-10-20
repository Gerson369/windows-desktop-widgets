// Test boot: intentionally has no native bridge beneath app.getAppPath().
const electron = require('electron')
electron.Notification.prototype.show = function () {}
require('../out/main/index.js')
