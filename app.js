// app.js — Entry point cho Passenger (cPanel Node.js App)
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
module.exports = require('./server/app');
