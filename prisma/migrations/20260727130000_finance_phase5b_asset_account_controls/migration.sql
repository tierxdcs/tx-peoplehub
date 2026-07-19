ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_asset_capitalisation_accounts_differ_check"
    CHECK ("assetAccountId" <> "acquisitionCreditAccountId"),
  ADD CONSTRAINT "fixed_asset_depreciation_accounts_differ_check"
    CHECK ("depreciationExpenseAccountId" <> "accumulatedDepreciationAccountId");
