"""A price source with fixed prices, for demos and tests: no network.

Prices come from `FAVA_BEANS_FIXED_PRICES` (JSON: ticker to price), else 100 for any ticker.
"""

import datetime
import json
import os
from decimal import Decimal

from beanprice import source


class Source(source.Source):
    def get_latest_price(self, ticker: str) -> source.SourcePrice | None:
        prices = json.loads(os.environ.get("FAVA_BEANS_FIXED_PRICES", "{}"))
        return source.SourcePrice(
            Decimal(str(prices.get(ticker, 100))), datetime.datetime.now(datetime.timezone.utc), "USD"
        )

    def get_historical_price(self, ticker: str, time: datetime.datetime) -> source.SourcePrice | None:
        return self.get_latest_price(ticker)
