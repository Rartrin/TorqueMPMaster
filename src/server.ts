import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as net from 'net';
import * as fs from 'fs-extra'
import * as path from 'path'
import * as dgram from 'dgram';
import { MPMasterServer } from './mpmasterserver';
// A class to store incoming web request data
class WebRequest {
    request: http.IncomingMessage;
    url: url.URL;
    searchParams: url.URLSearchParams; // Prefer this over url.searchParams cause we gonna parse the werid PQ post data too
    data: string | null;

    constructor(request: http.IncomingMessage, data: string | null) {
        this.url = new url.URL(request.url, 'http://localhost/');
        this.searchParams = this.url.searchParams;
        this.request = request;
        this.data = data;
        if (request.headers['content-type'] !== undefined) {
            if (request.headers['content-type'] === 'application/x-www-form-urlencoded') {
                // Yeah now we parse the query string
                if (data !== null) {
                    let qstr = data.split('&').map(x => x.split('=').map(y => decodeURIComponent(y).replace(/\+/g,' ')));
                    qstr.forEach(x => {
                        if (this.searchParams.has(x[0])) {
                            this.searchParams.append(x[0], x[1])
                        } else {
                            this.searchParams.set(x[0], x[1]);
                        }
                    });
                }
            }
        }
    }
}

// A class that stores the response data that is to be sent back
class WebResponse {

    // The response as string
    response: string;

    // The response code
    code: number;

    // The response headers
    headers: Map<string, string>;

    constructor(response: string, code: number, contentType: string) {
        this.response = response;
        this.code = code;
        this.headers = new Map<string, string>();
        this.headers.set("Content-Type", contentType);
    }
}

// A class that stores the valid URL route data
class WebRoute {
    // The URL route
    path: string;

    // The function that handles the request
    func: (request: WebRequest) => any;

    // A list that specifies valid request methods
    methods: string[] = ["GET"];


    constructor(path: string, fn: (request: WebRequest) => any, methods: string[]) {
        this.path = path;
        this.func = fn;
        this.methods = methods;
    }
}

// Stores the valid web routes, sadly due to how typescript decorators work, I can't put this in LBServer
let paths: Map<string, WebRoute>= new Map<string, WebRoute>();

// A method decorator that marks a function as a valid handler for a URL route
function route(path: string, methods: string[] = ["GET"]) {
    return  (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        paths.set(path, new WebRoute(path, descriptor.value, methods));
    };
}

export class WebServer {
    mpMasterServer: MPMasterServer
    mainServer: http.Server

    constructor() {

    }

    // Handles the response generation for the route handler functions and does type coercion
    response(resp: any, params: WebRequest, code: number = 200) {
        if (resp instanceof WebResponse) return this.tryPQify(resp, params);
        if (typeof resp === "string") return this.tryPQify(new WebResponse(resp, code, 'text/plain'), params);
        else if (resp instanceof Object) return this.tryPQify(new WebResponse(JSON.stringify(resp), code, 'application/json'), params);
        else return this.tryPQify(new WebResponse("Not Found", 404, 'text/plain'), params);
    }

    // Makes the response valid for pq to read
    tryPQify(resp: WebResponse, params: WebRequest) {
        if (params.searchParams.has("req")) {
            if (!resp.response.startsWith("pq")) { // Don't try to PQify whats already PQified
                let reqid = params.searchParams.get("req");
                resp.response = `pq ${reqid} ${resp.response}`;
                resp.headers.set("Content-Type", "text/plain");
            }
            return resp;
        };
        return resp;
    }

    // Starts the server
    start() {
        let settings = JSON.parse(fs.readFileSync('settings.json', 'utf-8'))

        let hostsplit = settings.apiServer.split(':'); // Naive but works for now
        let hostname = hostsplit[0];
        let port = Number.parseInt(hostsplit[1]);

        console.log("Starting Multiplayer Master Server");
        this.mpMasterServer = new MPMasterServer();
        this.mpMasterServer.initialize();
        console.log("Multiplayer Started");

        this.mainServer = http.createServer((req, res) => {
            if (req.method === 'POST') {
                let data: Buffer[] = [];
                req.on('data', chunk => data.push(chunk));
                req.on('end', () => {
                    let dataBuffer = Buffer.concat(data);
                    this.handleOnRequest(req, res, dataBuffer.toString());
                })
            } else {
                this.handleOnRequest(req, res, null);
            };
        }).listen(port, hostname);
        console.log("API HTTP Server Started");
    }

    handleOnRequest(req: http.IncomingMessage, res: http.ServerResponse, data: string) {
        let urlObject = new url.URL(req.url, 'http://localhost/');

        // Generate a default response
        var retresponse = new WebResponse("Not Found", 404, 'text/plain');

        console.log(`ATTEMPT ${urlObject.pathname}`);
        // Does the requested url have a valid WebRoute defined?
        if (paths.has(urlObject.pathname)) {
            // Get the route
            let route = paths.get(urlObject.pathname);
            console.log(`INCOMING ${route.path}`);
            // Are we using the valid request methods?
            if (route.methods.includes(req.method)) {

                let webreq = new WebRequest(req, data);

                // Get the response from the web route handler function
                try {
                    let resp = route.func.call(this, webreq);
                    // Handle the different return values
                    if (typeof resp === "string")
                        retresponse = this.response(resp, webreq, 200);
                    else if (resp instanceof Object)
                        retresponse = this.response(resp, webreq, 200);
                } catch (e) {
                    let err = e as Error;
                    // Webhook.log("Zenith error: " + err.toString() +"\nStack trace: \n" + err.stack);
                    console.log(e);
                }

                console.log(`OUTGOING ${route.path}`);
            }
        }

        // I guess here check what the path is and act accordingly
        // Write the header
        res.writeHead(retresponse.code, Object.fromEntries(retresponse.headers));
        // Now write the response
        res.end(retresponse.response);
    }

    // Stops the server
    dispose() {
        console.log("Stopping Multiplayer Master Server");
        this.mpMasterServer.dispose();
    }

    @route("/api/serverlist", ["GET"])
    getServerList(req: WebRequest) {
        return {
            servers: this.mpMasterServer.serverList
        }
    }
}
