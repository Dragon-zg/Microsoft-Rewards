import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import axiosRetry from 'axios-retry'
import type { AccountProxy } from '../interface/Account'
import { createProxyAgent } from './ProxyAgent'

class AxiosClient {
    private instance: AxiosInstance
    private account: AccountProxy

    constructor(account: AccountProxy) {
        this.account = account

        this.instance = axios.create({
            timeout: 20000
        })

        if (this.account.url && this.account.proxyAxios) {
            const agent = createProxyAgent(this.account, 'account')
            this.instance.defaults.httpAgent = agent
            this.instance.defaults.httpsAgent = agent
        }

        axiosRetry(this.instance, {
            retries: 5,
            retryDelay: axiosRetry.exponentialDelay,
            shouldResetTimeout: true,
            retryCondition: error => {
                if (axiosRetry.isNetworkError(error)) return true
                if (!error.response) return true

                const status = error.response.status
                return status === 429 || (status >= 500 && status <= 599)
            }
        })
    }

    public async request(config: AxiosRequestConfig, bypassProxy = false): Promise<AxiosResponse> {
        if (bypassProxy) {
            const bypassInstance = axios.create({
                timeout: 20000
            })
            axiosRetry(bypassInstance, {
                retries: 3,
                retryDelay: axiosRetry.exponentialDelay,
                shouldResetTimeout: true
            })
            return bypassInstance.request(config)
        }

        return this.instance.request(config)
    }
}

export default AxiosClient
