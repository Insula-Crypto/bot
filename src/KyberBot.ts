import BigNumber from 'bignumber.js';
import {
  Accounting,
  Hub,
  Trading,
  KyberNetworkProxy,
  KyberTradingAdapter,
  DeployedEnvironment,
  TokenDefinition,
  sameAddress,

} from '@melonproject/melonjs';

import { createEnvironment } from './utils/createEnvironment';

interface PriceQueryResult {
  baseCurrency: TokenDefinition;
  quoteCurrency: TokenDefinition;
  priceInBase: BigNumber;
  priceInQuote: BigNumber;
  sizeInBase: BigNumber;
  sizeInQuote: BigNumber;
  exchangeAddress: string;
}

export class KyberBot {
  public static async create(hubAddress: string, tokenOneSymbol: string, tokenTwoSymbol: string) {
    const environment = createEnvironment();
    const hub = new Hub(environment, hubAddress);
    const routes = await hub.getRoutes();
    const manager = await hub.getManager();
    const account = (await environment.client.getAccounts())[0];

    if (!sameAddress(manager, account)) {
      throw new Error('You are not the manager of this fund.');
    }

    const trading = new Trading(environment, routes.trading);
    const accounting = new Accounting(environment, routes.accounting);

    const adapterAddress = environment.deployment.melon.addr.KyberAdapter;
    const adapter = await KyberTradingAdapter.create(environment, adapterAddress, trading);

    const exchangeAddress = environment.deployment.kyber.addr.KyberNetworkProxy;

    const tokenOne = environment.getToken(tokenOneSymbol);
    const tokenTwo = environment.getToken(tokenTwoSymbol);

    return new this(environment, account, hub, trading, accounting, adapter, exchangeAddress, tokenOne, tokenTwo);
  }

  private constructor(
    public readonly environment: DeployedEnvironment,
    public readonly account: string,
    public readonly hubContract: Hub,
    public readonly tradingContract: Trading,
    public readonly accountingContract: Accounting,
    public readonly kyberAdapterContract: KyberTradingAdapter,
    public readonly kyberExchangeAddress: string,
    public readonly tokenOne: TokenDefinition,
    public readonly tokenTwo: TokenDefinition
  ) {}

  public async createTransaction(quantity: number) {
    const baseCurrency = this.tokenTwo;
    const quoteCurrency = this.tokenOne;
    const baseQuantity = quantity;

    // pass them all to the getPrice function to see what the rates are
    const priceObject = await this.getPrice(baseCurrency, quoteCurrency, new BigNumber(baseQuantity));

    return this.makeTransaction(priceObject);
    
  }

  public async getPrice(baseCurrency: TokenDefinition, quoteCurrency: TokenDefinition, baseQuantity: BigNumber) {
    // instantiate the exchange contract
    const exchange = new KyberNetworkProxy(this.environment, this.kyberExchangeAddress);

    // call the correct method to get the price. If the base currency is WETH, you want to go ETH => token and vice versa
    const quoteQuantity = await exchange.getExpectedRate(baseCurrency.address, quoteCurrency.address, baseQuantity); // quantity passed is in WETH if you're trying to sell WETH for MLN

    // price will be important if you're doing any TA. My magicFunction doesn't use it but I've included it anyway.
    const priceInBase = quoteQuantity.expectedRate.dividedBy(baseQuantity);
    const priceInQuote = new BigNumber(1).dividedBy(priceInBase);

    return {
      baseCurrency: baseCurrency,
      quoteCurrency: quoteCurrency,
      priceInBase: priceInBase,
      priceInQuote: priceInQuote,
      sizeInBase: baseQuantity,
      sizeInQuote: quoteQuantity.expectedRate.multipliedBy(baseQuantity.dividedBy(1e18)),
    } as PriceQueryResult;
  }

  public async makeTransaction(priceInfo: PriceQueryResult){
    // use the price query results to construct the uniswap order argument object
    const orderArgs = {
      makerQuantity: priceInfo.sizeInQuote.integerValue(),
      takerQuantity: priceInfo.sizeInBase.integerValue(),
      makerAsset: priceInfo.quoteCurrency.address,
      takerAsset: priceInfo.baseCurrency.address,
    };

    console.log(
      `Buying ${Number(orderArgs.makerQuantity) / 1e18} ${priceInfo.quoteCurrency.symbol} by selling ${Number(orderArgs.takerQuantity) / 1e18} ${priceInfo.baseCurrency.symbol}`
    );

    // instantiate the transaction object
    return this.kyberAdapterContract.takeOrder(this.account, orderArgs);
  }
}
