"""Billing guard for the Firebase project habits-433f8 (Haba, Trani, Cismo, Paco).

The budget "Guard 10 USD" posts to the Pub/Sub topic `billing-guard` several
times a day. When the month's cost reaches the budget, this turns billing off
for the project. Firebase then falls back to the free plan: the apps keep
working inside the free amounts, and paid services (Google Maps) stop until
Iker links the billing account again by hand.
"""
import base64
import json

import functions_framework
from googleapiclient import discovery

PROJECT = "habits-433f8"


@functions_framework.cloud_event
def stop_billing(cloud_event):
    data = json.loads(base64.b64decode(cloud_event.data["message"]["data"]).decode())
    cost, budget = data["costAmount"], data["budgetAmount"]
    print(f"cost {cost} of budget {budget} {data.get('currencyCode', '')}")
    if cost < budget:
        return
    billing = discovery.build("cloudbilling", "v1", cache_discovery=False)
    name = f"projects/{PROJECT}"
    if billing.projects().getBillingInfo(name=name).execute().get("billingEnabled"):
        billing.projects().updateBillingInfo(name=name, body={"billingAccountName": ""}).execute()
        print("billing turned off")
