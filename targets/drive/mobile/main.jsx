/* global __DEVELOPMENT__ */
import 'babel-polyfill'

import 'drive/styles/main'
import 'drive/styles/mobile'

import 'whatwg-fetch'
import React from 'react'
import { render } from 'react-dom'
import { hashHistory } from 'react-router'
import { CozyProvider } from 'cozy-client'

import { I18n, initTranslation } from 'cozy-ui/react/I18n'

import configureStore from 'drive/store/configureStore'
import { loadState } from 'drive/store/persistedState'

import { startBackgroundService } from 'drive/mobile/lib/background'
import { configureReporter } from 'drive/lib/reporter'
import {
  intentHandlerAndroid,
  intentHandlerIOS
} from 'drive/mobile/lib/intents'
import {
  startTracker,
  useHistoryForTracker,
  startHeartBeat,
  stopHeartBeat
} from 'drive/mobile/lib/tracker'
import { getTranslateFunction } from 'drive/mobile/lib/i18n'
import { scheduleNotification } from 'drive/mobile/lib/notification'
import { isIos } from 'drive/mobile/lib/device'
import {
  getLang,
  initClient,
  initBar,
  updateBarAccessToken,
  restoreCozyClientJs,
  resetClient,
  getOauthOptions
} from 'drive/mobile/lib/cozy-helper'
import DriveMobileRouter from 'drive/mobile/modules/authorization/DriveMobileRouter'
import { backupImages } from 'drive/mobile/modules/mediaBackup/duck'
import {
  revokeClient,
  getClientSettings,
  getToken,
  setToken,
  isClientRevoked
} from 'drive/mobile/modules/authorization/duck'
import { getServerUrl, isAnalyticsOn } from 'drive/mobile/modules/settings/duck'
import { startReplication } from 'drive/mobile/modules/replication/sagas'
/*We add fastclick only for iOS since Chrome removed this behavior (iOS also, but
we still use UIWebview and not WKWebview... )*/
if (isIos()) {
  var FastClick = require('fastclick')
  if ('addEventListener' in document) {
    document.addEventListener(
      'DOMContentLoaded',
      function() {
        FastClick.attach(document.body)
      },
      false
    )
  }
}

if (__DEVELOPMENT__) {
  // Enables React dev tools for Preact
  // Cannot use import as we are in a condition
  require('preact/devtools')
}

// Register callback for when the app is launched through cozydrive:// link
window.handleOpenURL = require('drive/mobile/lib/handleDeepLink').default(
  hashHistory
)

const startApplication = async function(store, client, polyglot) {
  configureReporter()

  let shouldInitBar = false

  try {
    const clientInfos = getClientSettings(store.getState())
    /*Since we can update our OauthConfig sometimes, we need to 
    override the cached one */
    const realOauthOptions =
      clientInfos !== null ? { ...clientInfos, ...getOauthOptions() } : null
    const token = getToken(store.getState())
    const oauthClient = client.getStackClient()
    oauthClient.setOAuthOptions(realOauthOptions)
    oauthClient.setCredentials(token)
    await restoreCozyClientJs(client.options.uri, realOauthOptions, token)
    oauthClient.onTokenRefresh = token => {
      updateBarAccessToken(token.accessToken)
      restoreCozyClientJs(client.options.uri, realOauthOptions, token)
      store.dispatch(setToken(token))
    }
    await oauthClient.fetchInformation()
    shouldInitBar = true
    await store.dispatch(startReplication())
  } catch (e) {
    console.warn(e)
    if (isClientRevoked(e, store.getState())) {
      console.warn('Your device is not connected to your server anymore')
      store.dispatch(revokeClient())
      resetClient(client)
    } else if (getServerUrl(store.getState())) {
      // the server is not responding, but it doesn't mean we're revoked yet
      shouldInitBar = true
    }
  } finally {
    if (shouldInitBar) initBar(client)
  }

  useHistoryForTracker(hashHistory)
  if (isAnalyticsOn(store.getState())) {
    startTracker(getServerUrl(store.getState()))
  }

  const root = document.querySelector('[role=application]')

  render(
    <I18n lang={getLang()} polyglot={polyglot}>
      <CozyProvider store={store} client={client}>
        <DriveMobileRouter history={hashHistory} />
      </CozyProvider>
    </I18n>,
    root
  )
}

// Allows to know if the launch of the application has been done by the service background
// @see: https://git.io/vSQBC
const isBackgroundServiceParameter = () => {
  const queryDict = location.search
    .substr(1)
    .split('&')
    .reduce((acc, item) => {
      const [prop, val] = item.split('=')
      return { ...acc, [prop]: val }
    }, {})

  return queryDict.backgroundservice
}

var app = {
  initialize: function() {
    this.bindEvents()

    if (__DEVELOPMENT__ && typeof cordova === 'undefined') this.onDeviceReady()
  },

  bindEvents: function() {
    document.addEventListener(
      'deviceready',
      this.onDeviceReady.bind(this),
      false
    )
    document.addEventListener('resume', this.onResume.bind(this), false)
    document.addEventListener('pause', this.onPause.bind(this), false)
  },

  getCozyURL: async function() {
    if (this.cozyURL) return this.cozyURL
    const persistedState = (await this.getPersistedState()) || {}
    // TODO: not ideal to access the server URL in the persisted state like this...
    this.cozyURL = persistedState.mobile
      ? persistedState.mobile.settings.serverUrl
      : ''
    return this.cozyURL
  },

  getPersistedState: async function() {
    if (this.persistedState) return this.persistedState
    this.persistedState = await loadState()
    return this.persistedState
  },

  getClient: async function() {
    if (this.client) return this.client
    const cozyURL = await this.getCozyURL()
    this.client = initClient(cozyURL)
    return this.client
  },

  getPolyglot: function() {
    if (!this.polyglot) {
      this.polyglot = initTranslation(getLang(), lang =>
        require(`drive/locales/${lang}`)
      )
    }
    return this.polyglot
  },

  getStore: async function() {
    if (this.store) return this.store
    const client = await this.getClient()
    const polyglot = this.getPolyglot()
    const persistedState = await this.getPersistedState()
    this.store = configureStore(
      client,
      polyglot.t.bind(polyglot),
      persistedState
    )
    return this.store
  },

  onDeviceReady: async function() {
    const store = await this.getStore()
    const client = await this.getClient()
    const polyglot = await this.getPolyglot()

    if (window.plugins && window.plugins.intentShim) {
      window.plugins.intentShim.onIntent(intentHandlerAndroid(store))
      window.plugins.intentShim.getIntent(intentHandlerAndroid(store), err => {
        console.error('Error getting launch intent', err)
      })
    }

    if (!isBackgroundServiceParameter()) {
      startApplication(store, client, polyglot)
    } else {
      startBackgroundService()
    }

    if (navigator && navigator.splashscreen) navigator.splashscreen.hide()
    store.dispatch(backupImages())
  },

  onResume: async function() {
    const store = await this.getStore()
    store.dispatch(backupImages())
    if (isAnalyticsOn(store.getState())) startHeartBeat()
  },

  onPause: async function() {
    const store = await this.getStore()
    if (isAnalyticsOn(store.getState())) stopHeartBeat()
    // TODO: selector
    if (store.getState().mobile.mediaBackup.currentUpload && isIos()) {
      const t = getTranslateFunction()
      scheduleNotification({
        text: t('mobile.notifications.backup_paused')
      })
    }
  }
}

app.initialize()
