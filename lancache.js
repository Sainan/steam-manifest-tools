const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const express = require("express");
const net = require("net");
const sni = require("sni");

const app = express();

app.use((req, res, next) => {
	res.on("finish", () => {
		console.log(`${req.socket.remoteAddress} - ${req.url} - ${res.statusCode}`);
	});
	next();
});

app.get("/depot/:depotId/chunk/:sha", async (req, res) => {
	if (fs.existsSync(__dirname + req.url)) {
		res.sendFile(__dirname + req.url);
	}
	else if (req.host.endsWith(".steamcontent.com")) {
		const fr = await fetch(`http://${req.host}${req.url}`);
		if (fr.status == 200) {
			const buf = Buffer.from(await fr.arrayBuffer());
			await fsPromises.mkdir(path.dirname(__dirname + req.url), { recursive: true });
			await fsPromises.writeFile(__dirname + req.url, buf);
			res.send(buf).end();
		}
		else {
			res.status(fr.status).send("Upstream error").end();
		}
	}
	else {
		res.status(400).send("Don't have this chunk").end();
	}
});

app.get("/depot/:depotId/patch/:oldManifestId/:newManifestId", async (req, res) => {
	if (fs.existsSync(__dirname + req.url)) {
		res.sendFile(__dirname + req.url);
	}
	else if (req.host.endsWith(".steamcontent.com")) {
		const fr = await fetch(`http://${req.host}${req.url}`);
		if (fr.status == 200) {
			const buf = Buffer.from(await fr.arrayBuffer());
			//await fsPromises.mkdir(path.dirname(__dirname + req.url), { recursive: true });
			//await fsPromises.writeFile(__dirname + req.url, buf);
			res.send(buf).end();
		}
		else {
			res.status(fr.status).send("Upstream error").end();
		}
	}
	else {
		res.status(400).send("Don't have this patch").end();
	}
});

app.use((req, res) => {
	res.status(400).send("Don't know this endpoint").end();
});

app.listen(80, () => {
	console.log("Listening on port 80");
});

// Transparently forward traffic on port 443 to avoid breaking HTTPS connections

net.createServer(socket => {
	socket.once("data", firstPacket => {
		const hostname = sni(firstPacket);
		if (!hostname) {
			return;
		}
		console.log(`${socket.remoteAddress} - Starting TLS proxy to ${hostname}`);
		const upstream = net.connect(443, hostname, () => {
			upstream.write(firstPacket);
			socket.pipe(upstream).pipe(socket);
		});
		upstream.on("error", () => socket.end());
	});
	socket.on("error", () => {});
}).listen(443, () => {
	console.log("Listening on port 443");
});
