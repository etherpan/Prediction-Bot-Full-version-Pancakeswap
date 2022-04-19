import { BigNumber } from "@ethersproject/bignumber";
import { JsonRpcProvider } from "@ethersproject/providers";
import { formatEther, parseEther } from "@ethersproject/units";
import { Wallet } from "@ethersproject/wallet";
import { blue, green, red } from "chalk";
import { clear } from "console";
import dotenv from "dotenv";
import {
  calculateTaxAmount,
  getClaimableEpochs,
  isBearBet,
  parseStrategy,
  reduceWaitingTimeByTwoBlocks,
  sleep,
} from "./lib";
import { PancakePredictionV2__factory } from "./types/typechain";

dotenv.config();

// Global Config
const GLOBAL_CONFIG = {
  PPV2_ADDRESS: "0x18B2A687610328590Bc8F2e5fEdDe3b582A49cdA",
  AMOUNT_TO_BET: 0.004, // in BNB,
  BSC_RPC: "https://bsc-dataseed.binance.org/", // You can provide any custom RPC
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  WAITING_TIME: 270219, // Waiting for 270sec = 4.5min
};

clear();
console.log(green("Start Game!!!"));

if (!GLOBAL_CONFIG.PRIVATE_KEY) {
  console.log(
    blue(
      "The private key was not found in .env. Enter the private key to .env and start the program again."
    )
  );

  process.exit(0);
}

const signer = new Wallet(
  GLOBAL_CONFIG.PRIVATE_KEY as string,
  new JsonRpcProvider(GLOBAL_CONFIG.BSC_RPC)
);

const predictionContract = PancakePredictionV2__factory.connect(
  GLOBAL_CONFIG.PPV2_ADDRESS,
  signer
);

const strategy = parseStrategy(process.argv);

let betAmount = GLOBAL_CONFIG.AMOUNT_TO_BET;

console.log(
  blue("Starting. Amount to Bet:", GLOBAL_CONFIG.AMOUNT_TO_BET, "BNB"),
  "\nWaiting for new rounds. It can take up to 5 min, please wait..."
);

let index = 0;

predictionContract.on("StartRound", async (epoch: BigNumber) => {
  console.log("\nStarted Epoch", epoch.toString());
  index ++;

  const WAITING_TIME = GLOBAL_CONFIG.WAITING_TIME;
  const prevEpoch = epoch.toNumber() - 2;
  const claimable = await predictionContract.claimable(prevEpoch, signer.address);
  const { position, amount } = await predictionContract.ledger(prevEpoch, signer.address);
  
  //2X stratagy
  if (!claimable && index > 2 && parseInt(amount.toString()) > 1) {
    const oldBetAmount = parseInt(amount.toString()) / 1000000000000000000;
    console.log("lodBetAmount", oldBetAmount);

    betAmount = oldBetAmount * 3;
    if(betAmount>0.3) {
      betAmount = GLOBAL_CONFIG.AMOUNT_TO_BET;
    }
  } else {
    betAmount = GLOBAL_CONFIG.AMOUNT_TO_BET;
  }

  console.log("Now waiting for", WAITING_TIME / 60000, "min");
  console.log("Current Index: ", index, " and BetAmount is ", betAmount);

  await sleep(WAITING_TIME);

  console.log("\nGetting Amounts");

  const { bullAmount, bearAmount } = await predictionContract.rounds(epoch);
  
  console.log(green("Bear Amount", formatEther(bearAmount), "BNB"));
  console.log(green("Bull Amount", formatEther(bullAmount), "BNB"));

  const bearBet = isBearBet(bullAmount, bearAmount, strategy);
  console.log("bearBet", bearBet);

  if (bearBet) {
    console.log(green("\nBetting on Bear Bet."));
  } else {
    console.log(green("\nBetting on Bull Bet."));
  }

  //betamount out in my wallet
  if (bearBet) {
    try {
      const tx = await predictionContract.betBear(epoch, {
        value: parseEther(betAmount.toString()),
      });

      console.log("Bear Betting Tx Started.");

      await tx.wait();

      console.log(blue("Bear Betting Tx Success."));
    } catch {
      console.log(red("Bear Betting Tx Error"));

      GLOBAL_CONFIG.WAITING_TIME = reduceWaitingTimeByTwoBlocks(
        GLOBAL_CONFIG.WAITING_TIME
      );
    }
  } else {
    try {
      const tx = await predictionContract.betBull(epoch, {
        value: parseEther(betAmount.toString()),
      });

      console.log("Bull Betting Tx Started.");

      await tx.wait();

      console.log(blue("Bull Betting Tx Success."));
    } catch {
      console.log(red("Bull Betting Tx Error"));

      GLOBAL_CONFIG.WAITING_TIME = reduceWaitingTimeByTwoBlocks(
        GLOBAL_CONFIG.WAITING_TIME
      );
    }
  }
  const claimEpoch = BigNumber.from(prevEpoch - 1);

  const claimableEpochs = await getClaimableEpochs(
    predictionContract,
    claimEpoch,
    signer.address
  );
 

  if (claimableEpochs.length > 2) {
    try {
      const tx = await predictionContract.claim(claimableEpochs);

      console.log("\nClaim Tx Started");

      await tx.wait();

      console.log(green("Claim Tx Success"));

    } catch {
      console.log(red("Claim Tx Error"));
    }
  }
});
