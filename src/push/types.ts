import type { Config } from '../interface/Config'

export interface PushAccountStats {
    email: string
    initialPoints: number
    finalPoints: number
    collectedPoints: number
    duration: number
    success: boolean
    error?: string
}

export interface PushRunSummaryContext {
    config: Config
    accountStats: PushAccountStats[]
    runStartTime: number
}

export interface PushProvider {
    name: string
    enabled(config: Config): boolean
    sendRunSummary(context: PushRunSummaryContext): Promise<void>
    flush(timeoutMs?: number): Promise<void>
}
