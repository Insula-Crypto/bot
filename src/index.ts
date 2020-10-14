import { TransactionReceipt } from 'web3-core';
import { UniswapBot } from './UniswapBot';
import { KyberBot } from './KyberBot';
import { getGasPrice } from './utils/getGasPrice';

interface Trade {
  buy: string;
  sell: string;
  quantity: string;
}

async function runv2(hub: string, data: Array<Trade>) {
  var errorCount = 0
  for (var index in data){
    try {
      console.log(`CREATING TRANSACTION ${index} ==>`);
      const UniswapTransaction = await (await UniswapBot.create(hub, data[index].buy, data[index].sell)).createTransaction(Number(data[index].quantity) * 1e18);
      const KyberTransaction = await (await KyberBot.create(hub, data[index].buy, data[index].sell)).createTransaction(Number(data[index].quantity) * 1e18);

      const transaction = UniswapTransaction.args[3][0] > KyberTransaction.args[3][0] ? UniswapTransaction : KyberTransaction;
      
      console.log('VALIDATING TRANSACTION');

      const receipt = await new Promise<TransactionReceipt>(async (resolve, reject) => {
        await transaction.validate();

        // query ethgasstation to figure out how much this'll cost
        console.log('FETCHING CURRENT GAS PRICE');
        const gasPrice = await getGasPrice(0.1);
        console.log(gasPrice);

        // instantiate the transactionOptions object
        console.log('ESTIMATION TRANSACTION GAS COST');
        const opts = await transaction.prepare({ gasPrice });

        console.log(opts)

        // send the transaction using the options object
        console.log('SENDING TRANSACTION');
        const tx = transaction.send(opts);

        tx.once('transactionHash', (hash) => console.log(`PENDING TRANSACTION: https://etherscan.io/tx/${hash}`));
        tx.once('receipt', (receipt) => resolve(receipt));
        tx.once('error', (error) => reject(error));
      });

      console.log(`TRANSACTION SUCCESSFUL`);
      console.log(`GAS USED: ${receipt.gasUsed}`);
    } catch (e) {
      console.error('THE BOT FAILED :*(');
      errorCount += 1;
      console.error(e);
    }
  }
  if(errorCount == 0) {
    console.log("No errors encountered on trading.")
  } else{
    console.log(`${errorCount} errors encountered during execution. Please refer to file errors.txt for more information.`)
  }
}

(async function main() {
  console.log('FIRING UP THE BOT ==>');
  const hub = process.env.HUB_ADDRESS;
  var data = [{buy : 'WBTC', sell : 'WETH', quantity : '1'}];
  runv2(hub, data);
})();
