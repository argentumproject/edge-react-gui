// @flow

import { createSimpleConfirmModal, showModal } from 'edge-components'
import type { EdgeAccount } from 'edge-core-js'
import React from 'react'
import { Platform } from 'react-native'
import Locale from 'react-native-locale'
import PushNotification from 'react-native-push-notification'
import { Actions } from 'react-native-router-flux'
import { sprintf } from 'sprintf-js'

import { name as appName } from '../../../app.json'
import { insertWalletIdsForProgress } from '../../actions/WalletActions.js'
import * as Constants from '../../constants/indexConstants'
import s from '../../locales/strings.js'
import * as ACCOUNT_API from '../Core/Account/api'
import * as SETTINGS_API from '../Core/Account/settings.js'
// Login/action.js
import * as CORE_SELECTORS from '../Core/selectors'
import { updateWalletsRequest } from '../Core/Wallets/action.js'
import type { Dispatch, GetState } from '../ReduxTypes'
import { Icon } from '../UI/components/Icon/Icon.ui.js'

const localeInfo = Locale.constants() // should likely be moved to login system and inserted into Redux

export const initializeAccount = (account: EdgeAccount, touchIdInfo: Object) => async (dispatch: Dispatch, getState: GetState) => {
  const currencyPlugins = []
  const currencyCodes = {}

  for (const pluginName in account.currencyConfig) {
    const { currencyInfo } = account.currencyConfig[pluginName]
    const { currencyCode } = currencyInfo
    currencyInfo.walletTypes.forEach(type => {
      currencyCodes[type] = currencyCode
    })
    currencyPlugins.push({ pluginName, currencyInfo })
  }
  dispatch({ type: 'ACCOUNT/LOGGED_IN', data: { account, currencyPlugins } })

  account.activeWalletIds.length < 1 ? Actions[Constants.ONBOARDING]() : Actions[Constants.EDGE]()

  const walletInfos = account.allKeys
  const filteredWalletInfos = walletInfos.map(({ keys, id, ...info }) => info)
  console.log('Wallet Infos:', filteredWalletInfos)

  const state = getState()
  const context = CORE_SELECTORS.getContext(state)
  if (Platform.OS === Constants.IOS) {
    PushNotification.configure({
      onNotification: notification => {
        console.log('NOTIFICATION:', notification)
      }
    })
  }
  const accountInitObject = {
    account: account,
    touchIdInfo: touchIdInfo,
    walletId: '',
    currencyCode: '',
    currencyPlugins,
    otpInfo: { enabled: account.otpKey != null, otpKey: account.otpKey, otpResetPending: false },
    autoLogoutTimeInSeconds: '',
    bluetoothMode: false,
    pinLoginEnabled: false,
    pinMode: false,
    otpMode: false,
    customTokens: '',
    defaultFiat: '',
    defaultIsoFiat: '',
    merchantMode: '',
    denominationKeys: [],
    customTokensSettings: [],
    activeWalletIds: [],
    archivedWalletIds: [],
    passwordReminder: {},
    isAccountBalanceVisible: false,
    isWalletFiatBalanceVisible: false,
    spendingLimits: {},
    passwordRecoveryRemindersShown: SETTINGS_API.PASSWORD_RECOVERY_REMINDERS_SHOWN
  }
  try {
    if (account.activeWalletIds.length < 1) {
      // we are going to assume that since there is no wallets, this is a first time user
      Actions[Constants.ONBOARDING]()
      // set the property on the user so that we can launch on boarding
      // lets create the wallet
      const ethWalletName = s.strings.string_first_ethereum_wallet_name
      const btcWalletName = s.strings.string_first_bitcoin_wallet_name
      const bchWalletName = s.strings.string_first_bitcoincash_wallet_name
      const ethWalletType = Constants.ETHEREUM_WALLET
      const btcWalletType = Constants.BITCOIN_WALLET
      const bchWalletType = Constants.BITCOINCASH_WALLET
      let fiatCurrencyCode = Constants.USD_FIAT
      if (localeInfo.currencyCode && typeof localeInfo.currencyCode === 'string' && localeInfo.currencyCode.length >= 3) {
        fiatCurrencyCode = 'iso:' + localeInfo.currencyCode
      }
      let edgeWallet
      if (global.currencyCode) {
        let walletType, walletName
        // We got installed via a currencyCode referral. Only create one wallet of that type
        for (const pluginName in account.currencyConfig) {
          const { currencyInfo } = account.currencyConfig[pluginName]
          if (currencyInfo.currencyCode.toLowerCase() === global.currencyCode.toLowerCase()) {
            walletType = currencyInfo.walletTypes[0]
            walletName = sprintf(s.strings.my_crypto_wallet_name, currencyInfo.currencyName)
            edgeWallet = await ACCOUNT_API.createCurrencyWalletRequest(account, walletType, { name: walletName, fiatCurrencyCode })
            global.firebase && global.firebase.analytics().logEvent(`Signup_Wallets_Created`)
          }
        }
      }
      if (!edgeWallet) {
        edgeWallet = await ACCOUNT_API.createCurrencyWalletRequest(account, btcWalletType, { name: btcWalletName, fiatCurrencyCode })
        await ACCOUNT_API.createCurrencyWalletRequest(account, bchWalletType, { name: bchWalletName, fiatCurrencyCode })
        await ACCOUNT_API.createCurrencyWalletRequest(account, ethWalletType, { name: ethWalletName, fiatCurrencyCode })
        global.firebase && global.firebase.analytics().logEvent(`Signup_Wallets_Created`)
      }
      accountInitObject.walletId = edgeWallet.id
      accountInitObject.currencyCode = edgeWallet.currencyInfo.currencyCode
    } else if (!state.core.deepLinking.deepLinkPending) {
      // We have a wallet
      Actions[Constants.EDGE]()
      const { walletId, currencyCode } = ACCOUNT_API.getFirstActiveWalletInfo(account, currencyCodes)
      accountInitObject.walletId = walletId
      accountInitObject.currencyCode = currencyCode
    }
    const activeWalletIds = account.activeWalletIds
    dispatch(insertWalletIdsForProgress(activeWalletIds))
    const archivedWalletIds = account.archivedWalletIds

    accountInitObject.activeWalletIds = activeWalletIds
    accountInitObject.archivedWalletIds = archivedWalletIds
    const settings = await SETTINGS_API.getSyncedSettings(account)
    const syncDefaults = SETTINGS_API.SYNCED_ACCOUNT_DEFAULTS
    const syncFinal = { ...syncDefaults, ...settings }
    const customTokens = settings ? settings.customTokens : []
    accountInitObject.autoLogoutTimeInSeconds = syncFinal.autoLogoutTimeInSeconds
    accountInitObject.defaultFiat = syncFinal.defaultFiat
    accountInitObject.defaultIsoFiat = `iso:${syncFinal.defaultFiat}`
    accountInitObject.merchantMode = syncFinal.merchantMode
    accountInitObject.customTokens = syncFinal.customTokens
    accountInitObject.passwordRecoveryRemindersShown = syncFinal.passwordRecoveryRemindersShown
    Object.keys(syncFinal).forEach(currencyCode => {
      if (typeof syncFinal[currencyCode].denomination === 'string') {
        accountInitObject.denominationKeys.push({ currencyCode: currencyCode, denominationKey: syncFinal[currencyCode].denomination })
      }
    })
    if (customTokens) {
      customTokens.forEach(token => {
        // dispatch(ADD_TOKEN_ACTIONS.setTokenSettings(token))
        accountInitObject.customTokensSettings.push(token)
        // this second dispatch will be redundant if we set 'denomination' property upon customToken creation
        accountInitObject.denominationKeys.push({ currencyCode: token.currencyCode, denominationKey: token.multiplier })
      })
    }
    const localSettings = await SETTINGS_API.getLocalSettings(account)
    const localDefaults = SETTINGS_API.LOCAL_ACCOUNT_DEFAULTS
    const localFinal = { ...localDefaults, ...localSettings }
    accountInitObject.bluetoothMode = localFinal.bluetoothMode
    accountInitObject.passwordReminder = localFinal.passwordReminder
    accountInitObject.isAccountBalanceVisible = localFinal.isAccountBalanceVisible
    accountInitObject.isWalletFiatBalanceVisible = localFinal.isWalletFiatBalanceVisible
    accountInitObject.spendingLimits = localFinal.spendingLimits

    accountInitObject.pinLoginEnabled = await context.pinLoginEnabled(account.username)

    const coreSettings = await SETTINGS_API.getCoreSettings(account)
    const coreDefaults = SETTINGS_API.CORE_DEFAULTS
    const coreFinal = { ...coreDefaults, ...coreSettings }
    accountInitObject.pinMode = coreFinal.pinMode
    accountInitObject.otpMode = coreFinal.otpMode

    PushNotification.checkPermissions(permissions => {
      if (!permissions.alert) {
        const name = appName[0].toUpperCase() + appName.slice(1)

        const modal = createSimpleConfirmModal({
          title: s.strings.security_warning,
          message: sprintf(s.strings.enable_notifications_modal, name),
          icon: <Icon type={Constants.MATERIAL_COMMUNITY} name={Constants.EXCLAMATION} size={30} />,
          buttonText: s.strings.string_ok
        })

        showModal(modal)
      }
    })

    dispatch({
      type: 'ACCOUNT_INIT_COMPLETE',
      data: { ...accountInitObject }
    })
    // $FlowFixMe
    dispatch(updateWalletsRequest())
  } catch (error) {
    console.log(error)
  }
}

export const logoutRequest = (username?: string) => (dispatch: Dispatch, getState: GetState) => {
  /* Actions.popTo(Constants.LOGIN, {username})

  const state = getState()
  dispatch(SETTINGS_ACTIONS.setLoginStatus(false))

  const account = CORE_SELECTORS.getAccount(state)
  dispatch(logout(username))
  ACCOUNT_API.logoutRequest(account) */
  Actions.popTo(Constants.LOGIN, { username })
  const state = getState()
  const account = CORE_SELECTORS.getAccount(state)
  dispatch(logout(username))
  account.logout()
}
export const deepLinkLogout = (backupKey: string) => (dispatch: Dispatch, getState: GetState) => {
  const state = getState()
  const account = CORE_SELECTORS.getAccount(state)
  const username = account.username
  Actions.popTo(Constants.LOGIN, { username })
  dispatch({ type: 'DEEP_LINK_RECEIVED', data: backupKey })
  // dispatch(logout('deepLinkReceived'))
  if (!account) {
    account.logout()
  }
}

export const logout = (username?: string) => ({
  type: 'LOGOUT',
  data: { username }
})
