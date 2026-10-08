"""A synchronous client for the legacy tests, in place of starlette's TestClient.

fastapi 0.104 pins starlette 0.27, whose TestClient passes app= to httpx.Client, and
httpx 0.28 removed that argument, so TestClient(app) raises TypeError. This sends each
request through httpx.ASGITransport, as the async tests do. Like ASGITransport it runs no
startup events, so nothing is ingested. httpx itself stays unpinned: the app uses it too.
"""
import asyncio

import httpx


class SyncASGIClient:
    def __init__(self, app, base_url="http://testserver"):
        self.app = app
        self.base_url = base_url

    def request(self, method, url, **kwargs):
        async def send():
            transport = httpx.ASGITransport(app=self.app)
            async with httpx.AsyncClient(transport=transport, base_url=self.base_url, follow_redirects=True) as client:
                return await client.request(method, url, **kwargs)
        return asyncio.run(send())

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)

    def patch(self, url, **kwargs):
        return self.request("PATCH", url, **kwargs)

    def delete(self, url, **kwargs):
        return self.request("DELETE", url, **kwargs)
