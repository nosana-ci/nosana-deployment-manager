import { DeploymentsApi, NosanaClient } from '@nosana/kit';

export const validateThatVaultIsUsable = async (deployerClient: NosanaClient, vaultAddress: string) => {
  const vaults = await (deployerClient.api.deployments as DeploymentsApi).vaults.list();
  const existingVault = vaults.find(v => v.address === vaultAddress);
  if (!existingVault) {
    throw new Error(`Vault with address ${vaultAddress} not found for deployer.`);
  }
  return existingVault;
}