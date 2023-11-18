import tracer from 'tracer';
import fs from 'fs';
import { type Config } from './config';
import Ajv2019 from "ajv/dist/2019";
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { spawnSync } from 'child_process';
import { IConfig } from 'config';

const logger = tracer.colorConsole({
    dateformat: "dd/mm/yyyy HH:MM:ss.l",
    level: 3
    // 0:'test', 1:'trace', 2:'debug', 3:'info', 4:'warn', 5:'error'
});

// suppress message from node-config when launched with pm2:
// 13|router  | WARNING: NODE_APP_INSTANCE value of '0' did not match any instance config file names.
// 13|router  | WARNING: See https://github.com/node-config/node-config/wiki/Strict-Mode
process.env.NODE_APP_INSTANCE = "";

const ajv = new Ajv2019({
    strict: true,
    ownProperties: true,
    strictRequired: true,
    verbose: true,
});

let config: IConfig;

ajv.addMetaSchema(draft7MetaSchema);

const SCHEMAFILE = './config.jtd.json';
const TYPEFILE = './config.ts'; // __filename
const FILE = "./config/default.json";

if (fs.lstatSync(TYPEFILE).mtimeMs > fs.lstatSync(SCHEMAFILE).mtimeMs) {
    // need to regenerate the json schema
    logger.info(`Regenerating schema...`);
    const ret = spawnSync(`./node_modules/.bin/typescript-json-schema`, `--required --noExtraProps ${TYPEFILE} Config -o ${SCHEMAFILE}`.split(' '));
    [ret.stdout, ret.stderr].map(s => s.toString('utf8')).forEach(s => s !== '' && logger.warn(s));
    logger.info(`Done generating schema.`)
}

const validate = ajv.compile(JSON.parse(fs.readFileSync(SCHEMAFILE, 'utf8')));

export default function loadConfig(): Config | false {

    // keep previous
    const previousConfigCache = require.cache[require.resolve('config')];
    const previousConfig = config;

    if (previousConfigCache || !config) {
        logger.debug(`Trying to load the configuration...`);
        delete require.cache[require.resolve('config')];
        try {
            config = require('config');
        } catch (err) {
            logger.warn((err as Error).message);
            require.cache[require.resolve('config')] = previousConfigCache;
            return false;
        }
        logger.debug(`Loaded configuration:`, config);
    }

    logger.debug(`Validating configuration...`);
    if (!validate(config) && validate.errors) {
        logger.warn(`Invalid config file "${FILE}":`);
        logger.warn(ajv.errorsText(validate.errors.map(err => { /*err.instancePath.replace("data", FILE);*/ return err })).replace("data", FILE));
        if (validate.errors[0].keyword === 'additionalProperties') {
            logger.warn(`Property "${validate.errors[0].params.additionalProperty}" in site "${validate.errors[0].instancePath}".`);
        }
        logger.debug(ajv.errorsText(validate.errors));
        logger.debug(validate.errors);

        // restore previous
        logger.debug(`Restoring previous config...`);
        delete require.cache[require.resolve('config')];
        require.cache[require.resolve('config')] = previousConfigCache;
        config = previousConfig;
        logger.debug(`Configuration is:`, config);
        return false;
    } else {
        logger.debug(`Configuration valid!`);
        try {
            config.util.makeImmutable(config);
        } catch (err) {
            logger.error((err as Error).message, (err as Error).stack);
        }
        logger.debug(`Configuration is:`, config);
        logger.info(`Loaded config file "${FILE}".`)
        const typedConfig = config as unknown as Config
        return typedConfig;
    }
}
