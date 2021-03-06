'use strict'

const { DefinePlugin, optimize } = require('webpack')

const path = require('path')
const pkg = require(path.resolve(__dirname, '../package.json'))

module.exports = {
  output: {
    filename: '[name].[hash].min.js'
  },
  devtool: 'source-map',
  plugins: [
    new optimize.UglifyJsPlugin({
      mangle: true,
      sourceMap: true,
      compress: {
        warnings: false
      }
    }),
    new DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'), // to compile on production mode (redux)
      __DEVELOPMENT__: false,
      __DEVTOOLS__: false,
      __STACK_ASSETS__: true,
      __PIWIK_SITEID__: 8,
      __PIWIK_SITEID_MOBILE__: 12,
      __PIWIK_DIMENSION_ID_APP__: 1,
      __PIWIK_TRACKER_URL__: JSON.stringify('https://matomo.cozycloud.cc'),
      __SENTRY_URL__: JSON.stringify('https://9259817fbb44484b8b7a0a817d968ae4@sentry.cozycloud.cc/6'),
      __APP_VERSION__: JSON.stringify(pkg.version)
    })
  ]
}
