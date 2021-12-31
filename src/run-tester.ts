import fs from 'fs';
import path from 'path';
import { exec } from '@actions/exec';
import type { Config } from 'eslint-remote-tester';

import {
    requirePeerDependency,
    ESLINT_REMOTE_TESTER_BIN,
} from './peer-dependencies';

const INTERNAL_CONFIG = './eslint-remote-tester-runner-internal.config';
export const RESULTS_TMP = '/tmp/results.json';

/**
 * Configuration values used internally. These are overwritten from user provided configuration
 */
const DEFAULT_CONFIG: Partial<Config> = {
    cache: false,
    CI: true,
};

const CONFIGURATION_TEMPLATE_BASE = `
    // Values from eslint-remote-tester-run-action's default configuration
    ...${JSON.stringify(DEFAULT_CONFIG, null, 4)},

    onComplete: async function onComplete(results, comparisonResults, repositoryCount) {
        // Write results to cache
        fs.writeFileSync('${RESULTS_TMP}', JSON.stringify({ results, repositoryCount }));

        if(usersConfig.onComplete) {
            await usersConfig.onComplete(results, comparisonResults, repositoryCount);
        }
    }
`;

const CONFIGURATION_TEMPLATE_JS = (pathToUsersConfiguration: string) =>
    `// Generated by eslint-remote-tester-run-action
const fs = require('fs');

// Load user's eslint-remote-tester.config.js
const usersConfig = require('${pathToUsersConfiguration}');

module.exports = {
    ...usersConfig,
    ${CONFIGURATION_TEMPLATE_BASE}
};
`;

const CONFIGURATION_TEMPLATE_TS = (pathToUsersConfiguration: string) =>
    `// Generated by eslint-remote-tester-run-action
import fs from 'fs';
import type { Config } from 'eslint-remote-tester';

// Load user's eslint-remote-tester.config.ts
import usersConfig from '${pathToUsersConfiguration.replace(/\.ts$/, '')}';

const config: Config = {
    ...usersConfig,
    ${CONFIGURATION_TEMPLATE_BASE}
};

export default config;
`;

/**
 * Run `eslint-remote-tester` and save results to temporary location
 */
export default async function runTester(configLocation: string): Promise<void> {
    const usersConfigLocation = path.resolve(configLocation);

    if (!fs.existsSync(ESLINT_REMOTE_TESTER_BIN)) {
        throw new Error(
            `Missing eslint-remote-tester. Expected it to be available at ${path.resolve(
                ESLINT_REMOTE_TESTER_BIN
            )}`
        );
    }
    if (!fs.existsSync(usersConfigLocation)) {
        throw new Error(
            `Unable to find eslint-remote-tester config with path ${usersConfigLocation}`
        );
    }

    const extension = usersConfigLocation.split('.').pop();
    const configTemplate =
        extension === 'ts'
            ? CONFIGURATION_TEMPLATE_TS
            : CONFIGURATION_TEMPLATE_JS;
    const createdConfig = `${INTERNAL_CONFIG}.${extension}`;

    // Write eslint-remote-tester configuration file
    fs.writeFileSync(createdConfig, configTemplate(usersConfigLocation));

    const { loadConfig, validateConfig } = requirePeerDependency(
        'eslint-remote-tester'
    );
    let config: Config;

    // Useless try-catch required by esbuild
    // eslint-disable-next-line no-useless-catch
    try {
        config = loadConfig(path.resolve(createdConfig));
    } catch (e) {
        throw e;
    }

    // Validate configuration before run
    await validateConfig(config, false);

    await exec(`${ESLINT_REMOTE_TESTER_BIN} --config ${createdConfig}`, [], {
        ignoreReturnCode: true,
        env: { ...process.env, NODE_OPTIONS: '--max_old_space_size=5120' },
    });
}
