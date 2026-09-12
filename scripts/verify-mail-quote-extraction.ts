import assert from "node:assert/strict";
import { extractSupplierQuote, type SupplierQuoteField } from "../packages/domain/src/mail-quote.ts";

function field(source: string, name: SupplierQuoteField, expected: string): void {
  const extracted = extractSupplierQuote(source).fields[name];
  assert.ok(extracted, `${name} should extract`);
  assert.equal(extracted.value, expected);
  assert.equal(source.slice(extracted.start, extracted.end), extracted.excerpt);
}

const supported = [
  "Quantity (pcs): 300",
  "MOQ: 100 pcs",
  "Incoterm: DDP Los Angeles, CA",
  "Valid until: 2030-02-28",
  "Product unit price (USD): 5.250000",
  "Unit freight: USD 1.20 per unit",
  "Unit duty (USD): 0",
  "Unit prep/inspection: USD 0.00",
  "Other landed unit cost USD: USD 0.125000",
  "Separate upfront costs (total): USD 120.00",
].join("\n");
const complete = extractSupplierQuote(supported);
assert.equal(Object.keys(complete.fields).length, 10);
field(supported, "quantity", "300");
field(supported, "moq", "100");
field(supported, "incoterm", "DDP Los Angeles, CA");
field(supported, "validUntil", "2030-02-28");
field(supported, "productUnitPrice", "5.25");
field(supported, "unitFreight", "1.2");
field(supported, "unitDuty", "0");
field(supported, "unitPrepInspection", "0");
field(supported, "otherLandedUnitCost", "0.125");
field(supported, "separateUpfrontCosts", "120");

const unsupported = extractSupplierQuote([
  "DDP unit price: USD 5.00",
  "Unit freight: EUR 1.00",
  "Valid until: 30 days",
  "Separate upfront costs: USD 100 per unit",
].join("\n"));
assert.equal(unsupported.fields.productUnitPrice, undefined);
assert.equal(unsupported.issues.productUnitPrice, "missing");
assert.equal(unsupported.issues.unitFreight, "invalid");
assert.equal(unsupported.issues.validUntil, "invalid");
assert.equal(unsupported.issues.separateUpfrontCosts, "invalid");

const tiers = extractSupplierQuote("Product unit price: USD 5\nProduct unit price: USD 5");
assert.equal(tiers.fields.productUnitPrice, undefined);
assert.equal(tiers.issues.productUnitPrice, "ambiguous");
const template = extractSupplierQuote("Quantity:\nProduct unit price (USD):");
assert.equal(template.issues.quantity, "missing");
assert.equal(template.issues.productUnitPrice, "missing");

const reply = "Product unit price: USD 7\n> Unit freight: USD 1\nOn Tue, Sep 1, 2026 at 10:00 AM Buyer wrote:\nUnit duty: USD 9";
const current = extractSupplierQuote(reply);
assert.equal(current.fields.productUnitPrice?.value, "7");
assert.equal(current.fields.unitFreight, undefined);
assert.equal(current.issues.unitFreight, "missing");
assert.equal(current.fields.unitDuty, undefined);
assert.equal(current.issues.unitDuty, "missing");

const invalid = extractSupplierQuote("Quantity: 0\nMOQ: 10000001 pcs\nValid until: 2025-02-29");
assert.equal(invalid.issues.quantity, "invalid");
assert.equal(invalid.issues.moq, "invalid");
assert.equal(invalid.issues.validUntil, "invalid");
const invalidPrecision = extractSupplierQuote("Product unit price: USD 1234567890123\nUnit freight: USD 1.1234567\nIncoterm: XYZ");
assert.equal(invalidPrecision.issues.productUnitPrice, "invalid");
assert.equal(invalidPrecision.issues.unitFreight, "invalid");
assert.equal(invalidPrecision.issues.incoterm, "invalid");
assert.equal(extractSupplierQuote(`Incoterm: DDP ${"A".repeat(197)}`).issues.incoterm, "invalid");

const unicode = "견적 🍵\nProduct unit price (USD): USD 0.50";
const unicodeField = extractSupplierQuote(unicode).fields.productUnitPrice;
assert.ok(unicodeField);
assert.equal(unicode.slice(unicodeField.start, unicodeField.end), "USD 0.50");

const malformed = extractSupplierQuote("Quantity 300\nProduct unit price USD 5\nAmazon fee: USD 3\nSale price: USD 10\nhttps://example.invalid");
assert.equal(Object.keys(malformed.fields).length, 0);
assert.equal(malformed.issues.quantity, "missing");
assert.equal(malformed.issues.productUnitPrice, "missing");
assert.equal(malformed.issues.unitFreight, "missing");
console.log(JSON.stringify({ scenario: "mail-quote-extraction", result: "PASS", assertions: ["labelled-single-tier", "zero-duty", "currency-and-relative-expiry-rejected", "duplicate-tiers-ambiguous", "quoted-history-ignored", "calendar-and-count-validation", "unicode-spans", "malformed-no-match"], externalNetworkCalls: 0 }));
