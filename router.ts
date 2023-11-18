import express from 'express';
import tracer from 'tracer';
import fs from 'fs';
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as colors from 'colors/safe';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import loadConfig from './loadconfig';
import { IncomingMessage, ServerResponse } from "http";
import morgan from 'morgan';
import { Config } from './config';
import * as chokidar from 'chokidar';
import compression from 'compression';

const logger = tracer.colorConsole({
    dateformat: "dd/mm/yyyy HH:MM:ss.l",
    level: 2
    // 0:'test', 1:'trace', 2:'debug', 3:'info', 4:'warn', 5:'error'
});

var module_dir = __dirname;
// remove trailing /dist if any
module_dir = module_dir.replace(/\/dist$/, '');

const app: express.Application = express();
const cacheOptions = {};
// need to reprocess POST requests because they are automatically handled as json content
const restream = (proxyReq: http.ClientRequest, req: express.Request, res: express.Response) => {
    if (req.body && req.originalUrl === '/carmaint/log?') {
        let bodyData = ""
        Object.keys(req.body).forEach(k => {
            if (bodyData !== "") bodyData += "&";
            bodyData = k + "=" + req.body[k];
        })
        // in case if content-type is application/x-www-form-urlencoded -> we need to change to application/json
        proxyReq.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        // stream the content
        proxyReq.write(bodyData);
    }
}

const watcher = chokidar.watch('./config/', { ignoreInitial: true, awaitWriteFinish: true });
watcher.on('all', (event, path) => {
    // ignore changes in git repository
    if (path.indexOf('/.git/') !== -1) return;

    console.log("Change detected:", event, path);

    conf = loadConfig();
    if (conf) {
        applyConfig(conf);
    }
});

const developmentFormatLine = (morgan as any)['dev'] as morgan.FormatFn<IncomingMessage, ServerResponse<IncomingMessage>>;
morgan.format('ext dev', function (tokens, req, res) {

    let foundsite: string | undefined = undefined;

    if (conf && (req as any)['originalUrl'] as string) Object.keys(conf).forEach(site => {
        if (!foundsite && conf)
            if (((req as any)['originalUrl'] as string)!.startsWith(conf[site].context) || Object.keys(conf[site].static || {}).filter(path => ((req as any)['originalUrl'] as string)!.startsWith(path)).length > 0)
                foundsite = site;
    });

    const now = new Date();

    const ms = now.getMilliseconds();

    return [
        now.toLocaleDateString(),
        [
            now.toLocaleTimeString(),
            '0'.repeat(2 - (ms ? Math.floor(Math.log10(ms)) : 0)) + ms,
        ].join('.'),
        '<info>',
        ['[', foundsite, ']'].join(''),
        developmentFormatLine(tokens, req, res),
    ].join(' ');

});

app.use(morgan('ext dev')); // logger

app.use(compression());

/**
 * the length of a clean app router stack (normally 3)
 */
const cleanAppRouterStackLength = getCleanAppRouterStackLength();
checkAppRouterStackClean();

/**
 * Computes the length of a clean app router stack (normally 2)
 * @returns 
 */
function getCleanAppRouterStackLength(): number {
    // create a fake middleware
    app.use(function MARKER() { });

    const stackLength = app._router.stack.length;

    // remove the last element, that we have added
    if (app._router.stack.length !== 5  // only 2 Layers
        || app._router.stack[0].name !== 'query' // First is query
        || app._router.stack[1].name !== 'expressInit'// second is expressInit
        || app._router.stack[2].name !== 'logger'
        || app._router.stack[3].name !== 'compression'
        || app._router.stack[stackLength - 1].name !== 'MARKER') {
        logger.error(`The app router stack is not as expected, is:`, app._router.stack);
        logger.error(`Code modification is needed!`);
    }
    (app._router.stack as Array<Object>).splice(stackLength - 1);

    return stackLength - 1;
}

/**
 * Check that the app router stack is clean
 */
function checkAppRouterStackClean() {
    if (app._router.stack.length !== cleanAppRouterStackLength
        || app._router.stack[0].name !== 'query' // First is query
        || app._router.stack[1].name !== 'expressInit'// second is expressInit
    ) {
        logger.error(`The app router stack is not as expected, is:`, app._router.stack);
        logger.error(`Code modification is needed!`);
    }
}

/**
 * Cleans the app router stack
 */
function cleanAppRouterStack() {
    if (app._router) {
        (app._router.stack as Array<Object>).splice(cleanAppRouterStackLength);
        checkAppRouterStackClean();
    }
}

function applyConfig(config: Config) {

    cleanAppRouterStack();

    Object.keys(config).forEach((site) => {
        console.log(`--- Configuring site ${site}:`);
        const statics = config[site].static;
        if (statics) Object.keys(statics).forEach((p) => {
            console.log(`Static: ${p} => ${statics[p]}`);
            app.use(`${p}`, express.static(__dirname + statics[p]));
        });
        const redirects = config[site].redirect;
        if (redirects) Object.keys(redirects).forEach((p) => {
            console.log(`Redirect: ${p} => ${redirects[p]}`);
            app.use(`${p}`, (req, res) => res.sendFile(path.join(module_dir, redirects[p])));
        });
        app.use(createProxyMiddleware(config[site].context, {
            target: config[site].target,
            changeOrigin: true,
            pathRewrite: config[site].pathRewrite,
            onProxyReq: restream,
        }));
    });

    false && app.use('/*', createProxyMiddleware({
        target: 'https://domo.bchabrier.com',
        changeOrigin: true,
        onProxyReq: restream,
    }));

}

let conf = loadConfig();
if (conf) applyConfig(conf);

app.post('/serial', (req, res) => {
    //console.log(colors.magenta(req.query['msg'] as string));
    const LMAX = 128;
    if (req.body.msg.length > LMAX) {
        console.log(colors.magenta(req.body.msg.substring(0, LMAX / 2)));
        console.log(colors.magenta('...'));
        console.log(colors.magenta(req.body.msg.substring(req.body.msg.length - LMAX / 2)));
    } else {
        console.log(colors.magenta(req.body.msg));
    }
    fs.appendFile('/tmp/domoja.log', req.body.msg, (err) => {
        if (err) logger.error(`Could not write to '/tmp/domoja.log':`, err);
        res.sendStatus(200);
    });
});


const options: https.ServerOptions = {
    key: fs.readFileSync(module_dir + '/../domoja/ssl/key.pem'),
    cert: fs.readFileSync(module_dir + '/../domoja/ssl/cert.pem')
};

const HTTPS_PORT = 443;
const server = https.createServer(options, app).listen(HTTPS_PORT, function () {
    console.log(`Express production server listening on port ${HTTPS_PORT}`);
});

const app80 = express();

false && app80.all('*', function (req, res) {
    console.log(req)
    return res.redirect(301, `https://${req.path}`);
});
