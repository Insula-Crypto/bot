import BigNumber from 'bignumber.js';
import {
  Accounting,
  Hub,
  Trading,
  UniswapExchange,
  UniswapTradingAdapter,
  UniswapFactory,
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

export class UniswapBot {
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

    const adapterAddress = environment.deployment.melon.addr.UniswapAdapter;
    const adapter = await UniswapTradingAdapter.create(environment, adapterAddress, trading);

    const factoryAddress = environment.deployment.uniswap.addr.UniswapFactory;
    const factory = new UniswapFactory(environment, factoryAddress);

    const tokenOne = environment.getToken(tokenOneSymbol);
    const tokenTwo = environment.getToken(tokenTwoSymbol);

    return new this(environment, account, hub, trading, accounting, adapter, factory, tokenOne, tokenTwo);
  }

  private constructor(
    public readonly environment: DeployedEnvironment,
    public readonly account: string,
    public readonly hubContract: Hub,
    public readonly tradingContract: Trading,
    public readonly accountingContract: Accounting,
    public readonly uniswapAdapterContract: UniswapTradingAdapter,
    public readonly uniswapFactoryContract: UniswapFactory,
    public readonly tokenOne: TokenDefinition,
    public readonly tokenTwo: TokenDefinition
  ) {}

  public fortuneTeller(expectedPrice: PriceQueryResult) {
    // this is my sophisticated trading strategy you could build
    // something more elaborate yourself.
    // return Math.random() > 0.5;
    return true
  }

  public async createTransaction(quantity: number) {
    const baseCurrency = this.tokenTwo;
    const quoteCurrency = this.tokenOne;
    const baseQuantity = quantity;

    // pass them all to the getPrice function to see what the rates are
    const priceObject = await this.getPrice(baseCurrency, quoteCurrency, new BigNumber(baseQuantity));

    if (this.fortuneTeller(priceObject)) {
      return this.makeTransaction(priceObject);
    }

    return null;
  }

  public async getPrice(baseCurrency: TokenDefinition, quoteCurrency: TokenDefinition, baseQuantity: BigNumber) {
    // Every uniswap exchange is WETH/someToken, and identified by the non-weth token
    const exchangeToken = baseCurrency.symbol === 'WETH' ? quoteCurrency : baseCurrency;

    // call the method to find the address
    const exchangeAddress = await this.uniswapFactoryContract.getExchange(exchangeToken.address);

    // instantiate the exchange contract
    const exchange = new UniswapExchange(this.environment, exchangeAddress);

    // call the correct method to get the price. If the base currency is WETH, you want to go ETH => token and vice versa
    const quoteQuantity =
      baseCurrency.symbol === 'WETH'
        ? await exchange.getEthToTokenInputPrice(baseQuantity) // quantity passed is in WETH if you're trying to sell WETH for MLN
        : await exchange.getTokenToEthInputPrice(baseQuantity); // quantity passed is in MLN if you're trying to sell MLN for WETH

    // price will be important if you're doing any TA. My magicFunction doesn't use it but I've included it anyway.
    const priceInBase = quoteQuantity.dividedBy(baseQuantity);
    const priceInQuote = new BigNumber(1).dividedBy(priceInBase);

    return {
      baseCurrency: baseCurrency,
      quoteCurrency: quoteCurrency,
      priceInBase: priceInBase,
      priceInQuote: priceInQuote,
      sizeInBase: baseQuantity,
      sizeInQuote: quoteQuantity,
      exchangeAddress: exchangeAddress,
    } as PriceQueryResult;
  }

  public async makeTransaction(priceInfo: PriceQueryResult){
    // adjust the target amount of token to buy
    const slippage = 0.01;

    // use the price query results to construct the uniswap order argument object
    const orderArgs = {
      makerQuantity: priceInfo.sizeInQuote.integerValue().multipliedBy(slippage),
      takerQuantity: priceInfo.sizeInBase.integerValue(),
      makerAsset: priceInfo.quoteCurrency.address,
      takerAsset: priceInfo.baseCurrency.address,
    };

    console.log(
      `Buying ${orderArgs.makerQuantity} ${priceInfo.quoteCurrency.symbol} by selling ${orderArgs.takerQuantity} ${priceInfo.baseCurrency.symbol}`
    );

    // instantiate the transaction object
    return this.uniswapAdapterContract.takeOrder(this.account, orderArgs);
  }
}
