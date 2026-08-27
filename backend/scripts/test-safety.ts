export const assertE2eAccountKind = (accountKind: string | undefined): void => {
  if (accountKind !== "e2e") {
    throw new Error(
      "Destructive test setup requires E2E_ACCOUNT_KIND=e2e; demo accounts are never enumerated or cleaned up",
    );
  }
};
