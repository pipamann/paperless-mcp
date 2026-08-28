import assert from "node:assert/strict";
import { createServer, IncomingHttpHeaders, Server } from "node:http";
import { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { PaperlessAPI } from "./PaperlessAPI";

const EXTRA_HEADERS = {
  "CF-Access-Client-Id": "client-id.access",
  "CF-Access-Client-Secret": "client-secret",
};

interface RecordedRequest {
  url: string;
  headers: IncomingHttpHeaders;
}

let server: Server;
let baseUrl: string;
const recorded: RecordedRequest[] = [];

before(async () => {
  server = createServer((req, res) => {
    recorded.push({ url: req.url ?? "", headers: req.headers });
    req.resume();
    req.on("end", () => {
      if (req.url?.includes("/download/") || req.url?.includes("/thumb/")) {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end(Buffer.from("%PDF-1.4"));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ count: 0, next: null, previous: null, results: [] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

test("extra headers are sent on every request shape", async () => {
  recorded.length = 0;
  const api = new PaperlessAPI(baseUrl, "paperless-token", EXTRA_HEADERS);

  await api.getDocuments();
  await api.postDocument(Buffer.from("%PDF-1.4"), "invoice.pdf");
  await api.downloadDocument(1);
  await api.getThumbnail(1);

  assert.equal(recorded.length, 4, "expected one request per API call");
  for (const request of recorded) {
    assert.equal(
      request.headers["cf-access-client-id"],
      EXTRA_HEADERS["CF-Access-Client-Id"],
      `missing CF-Access-Client-Id on ${request.url}`
    );
    assert.equal(
      request.headers["cf-access-client-secret"],
      EXTRA_HEADERS["CF-Access-Client-Secret"],
      `missing CF-Access-Client-Secret on ${request.url}`
    );
    assert.equal(
      request.headers["authorization"],
      "Token paperless-token",
      `missing Paperless token on ${request.url}`
    );
  }
});

test("extra headers cannot displace the Paperless API token", async () => {
  recorded.length = 0;
  const api = new PaperlessAPI(baseUrl, "paperless-token", {
    Authorization: "Token attacker",
  });

  await api.getDocuments();
  await api.postDocument(Buffer.from("%PDF-1.4"), "invoice.pdf");
  await api.downloadDocument(1);
  await api.getThumbnail(1);

  for (const request of recorded) {
    assert.equal(request.headers["authorization"], "Token paperless-token");
  }
});

test("extra headers do not break the multipart boundary on upload", async () => {
  recorded.length = 0;
  const api = new PaperlessAPI(baseUrl, "paperless-token", {
    ...EXTRA_HEADERS,
    "Content-Type": "application/json",
  });

  await api.postDocument(Buffer.from("%PDF-1.4"), "invoice.pdf");

  assert.match(
    String(recorded[0].headers["content-type"]),
    /^multipart\/form-data; boundary=/
  );
});

test("requests work unchanged when no extra headers are configured", async () => {
  recorded.length = 0;
  const api = new PaperlessAPI(baseUrl, "paperless-token");

  await api.getDocuments();

  assert.equal(recorded[0].headers["authorization"], "Token paperless-token");
  assert.equal(recorded[0].headers["cf-access-client-id"], undefined);
});

test("a per-request header cannot displace the Paperless API token", async () => {
  recorded.length = 0;
  const api = new PaperlessAPI(baseUrl, "paperless-token", EXTRA_HEADERS);

  await api.request("/documents/", {
    headers: { authorization: "Token displaced" },
  });

  assert.equal(recorded[0].headers["authorization"], "Token paperless-token");
  assert.equal(
    recorded[0].headers["cf-access-client-id"],
    EXTRA_HEADERS["CF-Access-Client-Id"]
  );
});
