"""Seed the Social Security figures the fetcher usually cannot reach.

SSA answers 403 to almost every automated request, so fetch_retirement_limits will keep
whatever is already on file rather than refresh it. That is the correct failure mode for
a fetcher and the wrong one for a figure, so each value carries the year it belongs to.
The guide checks that year and refuses to use a stale cap rather than quietly bounding a
2028 reader with a 2026 wage base.

Read from ssa.gov on 2026-08-13:
  contribution and benefit base, 2026        184,500   (oact/cola/cbb.html)
  maximum benefit at full retirement age 67    4,207   (oact/cola/examplemax.html)
"""
import io, json, os

P = os.path.join("data", "rates.json")
d = json.load(io.open(P, encoding="utf-8"))
d["ssTaxableMax"] = 184500
d["ssTaxableMaxYear"] = 2026
d["ssSource"] = "Social Security Administration, contribution and benefit base"
d["ssMaxBenefitFRA"] = 4207
d["ssMaxBenefitFRAAge"] = 67
d["ssMaxBenefitFRAYear"] = 2026
d["ssMaxBenefitSource"] = ("Social Security Administration, benefits for workers with "
                           "maximum-taxable earnings")
io.open(P, "w", encoding="utf-8").write(json.dumps(d, indent=2) + "\n")
print("seeded:")
for k, v in d.items():
    if k.startswith("ss") or k.startswith("deferral") or k.startswith("comp"):
        print("   %-22s %s" % (k, v))
