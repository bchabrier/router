
export type Config = {
    [site: string]: {
        context: string,
        target: string,
        pathRewrite?: {
            [path: string]: string,
        },
        redirect?: {
            [path: string]: string,
        },
        static?: {
            [path: string]: string,
        }

    }
};


const sampleconf: Config = {
    "flowbird": {
        context: "/flowbird",
        target: 'http://192.168.0.10:4000',
        pathRewrite: {
            '^/flowbird': '/',
        },
    }
}

