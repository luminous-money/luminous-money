"""Print the API's OpenAPI schema, the contract that packages/ledger-client is generated from."""

import json

from .api import create_app
from .service import Ledger
from .store import Store

if __name__ == "__main__":
    print(json.dumps(create_app(Ledger(Store(":memory:"))).openapi(), indent=2, sort_keys=True))
