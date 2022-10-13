import { utils, BigNumberish, BigNumber } from "ethers";

export const floatToFixed = (num: number, decimals = 18): BigNumber => {
  return BigNumber.from(utils.parseUnits(num.toString(), decimals));
};

export const fixedToFloat = (num: BigNumberish, decimals = 18) => {
  return parseFloat(utils.formatUnits(num, decimals));
};

export function encodePath(path: string[]): string {
  let encoded = "0x";
  for (let i = 0; i < path.length; i++) {
    encoded += path[i].slice(2);
  }
  return encoded.toLowerCase();
}
