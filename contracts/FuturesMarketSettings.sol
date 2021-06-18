pragma solidity ^0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinSystemSettings.sol";
import "./interfaces/IFuturesMarketSettings.sol";

// Internal references
import "./interfaces/IFuturesMarket.sol";

// https://docs.synthetix.io/contracts/source/contracts/futuresmarketSettings
contract FuturesMarketSettings is Owned, MixinSystemSettings, IFuturesMarketSettings {
    // TODO: Convert funding rate from daily to per-second
    struct Parameters {
        uint takerFee;
        uint makerFee;
        uint maxLeverage;
        uint maxMarketValue;
        uint maxFundingRate;
        uint maxFundingRateSkew;
        uint maxFundingRateDelta;
    }

    /* ========== STATE VARIABLES ========== */

    mapping(bytes32 => Parameters) public parameters;
    mapping(bytes32 => address) public markets;

    /* ---------- Parameter Names ---------- */

    bytes32 internal constant PARAMETER_TAKERFEE = "takerFee";
    bytes32 internal constant PARAMETER_MAKERFEE = "makerFee";
    bytes32 internal constant PARAMETER_MAXLEVERAGE = "maxLeverage";
    bytes32 internal constant PARAMETER_MAXMARKETVALUE = "maxMarketValue";
    bytes32 internal constant PARAMETER_MAXFUNDINGRATE = "maxFundingRate";
    bytes32 internal constant PARAMETER_MAXFUNDINGRATESKEW = "maxFundingRateSkew";
    bytes32 internal constant PARAMETER_MAXFUNDINGRATEDELTA = "maxFundingRateDelta";

    /* ========== CONSTRUCTOR ========== */

    constructor(address _owner, address _resolver) public Owned(_owner) MixinSystemSettings(_resolver) {}

    /* ========== MUTATIVE FUNCTIONS ========== */

    function connectMarket(bytes32 _baseAsset, address _marketAddress) external onlyOwner {
        markets[_baseAsset] = _marketAddress;
        emit MarketConnected(_baseAsset, _marketAddress);
    }

    /* ---------- Setters ---------- */

    function setTakerFee(bytes32 _baseAsset, uint _takerFee) external onlyOwner {
        require(_takerFee <= 1 ether, "taker fee greater than 1");
        parameters[_baseAsset].takerFee = _takerFee;
        emit ParameterUpdated(_baseAsset, PARAMETER_TAKERFEE, _takerFee);
    }

    function setMakerFee(bytes32 _baseAsset, uint _makerFee) external onlyOwner {
        require(_makerFee <= 1 ether, "maker fee greater than 1");
        parameters[_baseAsset].makerFee = _makerFee;
        emit ParameterUpdated(_baseAsset, PARAMETER_MAKERFEE, _makerFee);
    }

    function setMaxLeverage(bytes32 _baseAsset, uint _maxLeverage) external onlyOwner {
        parameters[_baseAsset].maxLeverage = _maxLeverage;
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXLEVERAGE, _maxLeverage);
    }

    function setMaxMarketValue(bytes32 _baseAsset, uint _maxMarketValue) external onlyOwner {
        parameters[_baseAsset].maxMarketValue = _maxMarketValue;
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXMARKETVALUE, _maxMarketValue);
    }

    // TODO: Setting this parameter should record funding first.
    function setMaxFundingRate(bytes32 _baseAsset, uint _maxFundingRate) external onlyOwner {
        IFuturesMarket futuresMarket = IFuturesMarket(markets[_baseAsset]);
        futuresMarket.recomputeFunding(futuresMarket.assetPriceRequireNotInvalid());
        parameters[_baseAsset].maxFundingRate = _maxFundingRate;
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXFUNDINGRATE, _maxFundingRate);
    }

    // TODO: Setting this parameter should record funding first.
    function setMaxFundingRateSkew(bytes32 _baseAsset, uint _maxFundingRateSkew) external onlyOwner {
        IFuturesMarket futuresMarket = IFuturesMarket(markets[_baseAsset]);
        futuresMarket.recomputeFunding(futuresMarket.assetPriceRequireNotInvalid());
        parameters[_baseAsset].maxFundingRateSkew = _maxFundingRateSkew;
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXFUNDINGRATESKEW, _maxFundingRateSkew);
    }

    // TODO: Setting this parameter should record funding first.
    function setMaxFundingRateDelta(bytes32 _baseAsset, uint _maxFundingRateDelta) external onlyOwner {
        IFuturesMarket futuresMarket = IFuturesMarket(markets[_baseAsset]);
        futuresMarket.recomputeFunding(futuresMarket.assetPriceRequireNotInvalid());
        parameters[_baseAsset].maxFundingRateDelta = _maxFundingRateDelta;
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXFUNDINGRATEDELTA, _maxFundingRateDelta);
    }

    function setAllParameters(
        bytes32 _baseAsset,
        uint _takerFee,
        uint _makerFee,
        uint _maxLeverage,
        uint _maxMarketValue,
        uint[3] calldata _fundingParameters
    ) external onlyOwner {
        parameters[_baseAsset].takerFee = _takerFee;
        emit ParameterUpdated(_baseAsset, PARAMETER_TAKERFEE, _takerFee);

        parameters[_baseAsset].makerFee = _makerFee;
        emit ParameterUpdated(_baseAsset, PARAMETER_MAKERFEE, _makerFee);

        parameters[_baseAsset].maxLeverage = _maxLeverage;
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXLEVERAGE, _maxLeverage);

        parameters[_baseAsset].maxMarketValue = _maxMarketValue;
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXMARKETVALUE, _maxMarketValue);

        parameters[_baseAsset].maxFundingRate = _fundingParameters[0];
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXFUNDINGRATE, _fundingParameters[0]);

        parameters[_baseAsset].maxFundingRateSkew = _fundingParameters[1];
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXFUNDINGRATESKEW, _fundingParameters[1]);

        parameters[_baseAsset].maxFundingRateDelta = _fundingParameters[2];
        emit ParameterUpdated(_baseAsset, PARAMETER_MAXFUNDINGRATEDELTA, _fundingParameters[2]);
    }

    /* ---------- Getters ---------- */

    function getTakerFee(bytes32 _baseAsset) external view returns (uint) {
        return parameters[_baseAsset].takerFee;
    }

    function getMakerFee(bytes32 _baseAsset) external view returns (uint) {
        return parameters[_baseAsset].makerFee;
    }

    function getMaxLeverage(bytes32 _baseAsset) external view returns (uint) {
        return parameters[_baseAsset].maxLeverage;
    }

    function getMaxMarketValue(bytes32 _baseAsset) external view returns (uint) {
        return parameters[_baseAsset].maxMarketValue;
    }

    function getMaxFundingRate(bytes32 _baseAsset) external view returns (uint) {
        return parameters[_baseAsset].maxFundingRate;
    }

    function getMaxFundingRateSkew(bytes32 _baseAsset) external view returns (uint) {
        return parameters[_baseAsset].maxFundingRateSkew;
    }

    function getMaxFundingRateDelta(bytes32 _baseAsset) external view returns (uint) {
        return parameters[_baseAsset].maxFundingRateDelta;
    }

    function getAllParameters(bytes32 _baseAsset)
        external
        view
        returns (
            uint takerFee,
            uint makerFee,
            uint maxLeverage,
            uint maxMarketValue,
            uint maxFundingRate,
            uint maxFundingRateSkew,
            uint maxFundingRateDelta
        )
    {
        takerFee = parameters[_baseAsset].takerFee;
        makerFee = parameters[_baseAsset].makerFee;
        maxLeverage = parameters[_baseAsset].maxLeverage;
        maxMarketValue = parameters[_baseAsset].maxMarketValue;
        maxFundingRate = parameters[_baseAsset].maxFundingRate;
        maxFundingRateSkew = parameters[_baseAsset].maxFundingRateSkew;
        maxFundingRateDelta = parameters[_baseAsset].maxFundingRateDelta;
    }

    /* ========== EVENTS ========== */

    event ParameterUpdated(bytes32 indexed asset, bytes32 indexed parameter, uint value);
    event MarketConnected(bytes32 indexed market, address marketAddress);
}
