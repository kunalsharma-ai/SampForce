-- Single sign-on and SCIM provisioning are included on every plan, so the plan catalogue no longer carries
-- an `sso` entitlement.
UPDATE plans SET entitlements = entitlements - 'sso';
