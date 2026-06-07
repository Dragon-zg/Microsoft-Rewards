import axios, { AxiosRequestConfig } from 'axios'
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'

import type { ChromeVersion, EdgeVersion } from '../interface/UserAgentUtil'
import type { MicrosoftRewardsBot } from '../index'

export class UserAgentManager {
    private static readonly NOT_A_BRAND_VERSION = '99'
    private static readonly VERSION_REQUEST_TIMEOUT_MS = 20000
    private static readonly VERSION_REQUEST_MAX_RETRIES = 10
    private static readonly VERSION_REQUEST_RETRY_BASE_DELAY_MS = 1000
    private static readonly VERSION_REQUEST_RETRY_MAX_DELAY_MS = 30000

    constructor(private bot: MicrosoftRewardsBot) {}

    async getUserAgent(isMobile: boolean) {
        const system = this.getSystemComponents(isMobile)
        const app = await this.getAppComponents(isMobile)

        const uaTemplate = isMobile
            ? `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${app.chrome_reduced_version} Mobile Safari/537.36 EdgA/${app.edge_version}`
            : `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${app.chrome_reduced_version} Safari/537.36 Edg/${app.edge_version}`

        const platformVersion = `${isMobile ? Math.floor(Math.random() * 5) + 9 : Math.floor(Math.random() * 15) + 1}.0.0`

        const uaMetadata = {
            isMobile,
            platform: isMobile ? 'Android' : 'Windows',
            fullVersionList: [
                { brand: 'Not/A)Brand', version: `${UserAgentManager.NOT_A_BRAND_VERSION}.0.0.0` },
                { brand: 'Microsoft Edge', version: app['edge_version'] },
                { brand: 'Chromium', version: app['chrome_version'] }
            ],
            brands: [
                { brand: 'Not/A)Brand', version: UserAgentManager.NOT_A_BRAND_VERSION },
                { brand: 'Microsoft Edge', version: app['edge_major_version'] },
                { brand: 'Chromium', version: app['chrome_major_version'] }
            ],
            platformVersion,
            architecture: isMobile ? '' : 'x86',
            bitness: isMobile ? '' : '64',
            model: ''
        }

        return { userAgent: uaTemplate, userAgentMetadata: uaMetadata }
    }

    async getChromeVersion(isMobile: boolean): Promise<string> {
        const data = await this.fetchWithRetry<ChromeVersion>(
            {
                url: 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            },
            'USERAGENT-CHROME-VERSION',
            isMobile
        )
        return data.channels.Stable.version
    }

    async getEdgeVersions(isMobile: boolean) {
        const data = await this.fetchWithRetry<EdgeVersion[]>(
            {
                url: 'https://edgeupdates.microsoft.com/api/products',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            },
            'USERAGENT-EDGE-VERSION',
            isMobile
        )
        const stable = data.find(x => x.Product == 'Stable') as EdgeVersion
        return {
            android: stable.Releases.find(x => x.Platform == 'Android')?.ProductVersion,
            windows: stable.Releases.find(x => x.Platform == 'Windows' && x.Architecture == 'x64')?.ProductVersion
        }
    }

    private async fetchWithRetry<T>(config: AxiosRequestConfig, tag: string, isMobile: boolean): Promise<T> {
        const max = UserAgentManager.VERSION_REQUEST_MAX_RETRIES
        let lastError: unknown

        for (let attempt = 1; attempt <= max; attempt++) {
            try {
                const response = await axios({
                    timeout: UserAgentManager.VERSION_REQUEST_TIMEOUT_MS,
                    ...config
                })
                return response.data as T
            } catch (error) {
                lastError = error
                if (attempt >= max) break

                this.bot.logger.warn(
                    isMobile,
                    tag,
                    `Attempt ${attempt}/${max} failed: ${error instanceof Error ? error.message : String(error)}`
                )
                const delay = Math.min(
                    UserAgentManager.VERSION_REQUEST_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
                    UserAgentManager.VERSION_REQUEST_RETRY_MAX_DELAY_MS
                )
                await this.bot.utils.wait(delay)
            }
        }

        this.bot.logger.error(
            isMobile,
            tag,
            `An error occurred: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        )
        throw lastError
    }

    getSystemComponents(mobile: boolean): string {
        if (mobile) {
            const androidVersion = 10 + Math.floor(Math.random() * 5)
            return `Linux; Android ${androidVersion}; K`
        }

        return 'Windows NT 10.0; Win64; x64'
    }

    async getAppComponents(isMobile: boolean) {
        const versions = await this.getEdgeVersions(isMobile)
        const edgeVersion = isMobile ? versions.android : (versions.windows as string)
        const edgeMajorVersion = edgeVersion?.split('.')[0]

        const chromeVersion = await this.getChromeVersion(isMobile)
        const chromeMajorVersion = chromeVersion?.split('.')[0]
        const chromeReducedVersion = `${chromeMajorVersion}.0.0.0`

        return {
            not_a_brand_version: `${UserAgentManager.NOT_A_BRAND_VERSION}.0.0.0`,
            not_a_brand_major_version: UserAgentManager.NOT_A_BRAND_VERSION,
            edge_version: edgeVersion as string,
            edge_major_version: edgeMajorVersion as string,
            chrome_version: chromeVersion as string,
            chrome_major_version: chromeMajorVersion as string,
            chrome_reduced_version: chromeReducedVersion as string
        }
    }

    async updateFingerprintUserAgent(
        fingerprint: BrowserFingerprintWithHeaders,
        isMobile: boolean
    ): Promise<BrowserFingerprintWithHeaders> {
        try {
            const userAgentData = await this.getUserAgent(isMobile)
            const componentData = await this.getAppComponents(isMobile)

            //@ts-expect-error Errors due it not exactly matching
            fingerprint.fingerprint.navigator.userAgentData = userAgentData.userAgentMetadata
            fingerprint.fingerprint.navigator.userAgent = userAgentData.userAgent
            fingerprint.fingerprint.navigator.appVersion = userAgentData.userAgent.replace(
                `${fingerprint.fingerprint.navigator.appCodeName}/`,
                ''
            )

            fingerprint.headers['user-agent'] = userAgentData.userAgent
            fingerprint.headers['sec-ch-ua'] =
                `"Microsoft Edge";v="${componentData.edge_major_version}", "Not=A?Brand";v="${componentData.not_a_brand_major_version}", "Chromium";v="${componentData.chrome_major_version}"`
            fingerprint.headers['sec-ch-ua-full-version-list'] =
                `"Microsoft Edge";v="${componentData.edge_version}", "Not=A?Brand";v="${componentData.not_a_brand_version}", "Chromium";v="${componentData.chrome_version}"`

            /*
            Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.0.0
            sec-ch-ua-full-version-list: "Microsoft Edge";v="129.0.2792.84", "Not=A?Brand";v="8.0.0.0", "Chromium";v="129.0.6668.90"
            sec-ch-ua: "Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129"
    
            Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36
            "Google Chrome";v="129.0.6668.90", "Not=A?Brand";v="8.0.0.0", "Chromium";v="129.0.6668.90"
            */

            return fingerprint
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'USER-AGENT-UPDATE',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }
}
