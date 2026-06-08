import { wxPusherProvider } from './WxPusher'
import type { Config } from '../interface/Config'
import type { PushAccountStats, PushProvider } from './types'

const pushProviders: PushProvider[] = [wxPusherProvider]

export async function sendRunSummaryPush(
    config: Config,
    accountStats: PushAccountStats[],
    runStartTime: number
): Promise<void> {
    const enabledProviders = pushProviders.filter(provider => provider.enabled(config))
    if (enabledProviders.length === 0) return

    const context = { config, accountStats, runStartTime }
    await Promise.allSettled(enabledProviders.map(provider => provider.sendRunSummary(context)))
}

export async function flushPushQueues(timeoutMs = 5000): Promise<void> {
    await Promise.allSettled(pushProviders.map(provider => provider.flush(timeoutMs)))
}
