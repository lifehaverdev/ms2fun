import { Component } from '../../core/Component.js';
import {tradingStore} from '../../store/tradingStore.js';
import { eventBus } from '../../core/EventBus.js';

export class BondingCurve extends Component {
    constructor() {
        super();
        this.state = {
            currentPrice: 0,
            totalBondingSupply: 0,
            totalMessages: 0,
            totalNFTs: 0,
            dataReady: false,
            contractEthBalance: 0,
            liquidityPool: null,
            chainId: null
        };
    }

    async initialize() {
        try {
            // Fetch network ID from switch.json
            const response = await fetch('/EXEC404/switch.json');
            const config = await response.json();
            this.setState({ chainId: config.network });
            
            // Check liquidity pool status first
            const liquidityPool = tradingStore.selectContractData().liquidityPool;
            this.setState({ liquidityPool });

            // Subscribe to contract data updates
            eventBus.on('contractData:updated', () => {
                const contractData = tradingStore.selectContractData();
                
                if (contractData.liquidityPool !== this.state.liquidityPool) {
                    this.setState({ liquidityPool: contractData.liquidityPool });
                    
                    if (this.isLiquidityDeployed()) {
                        this.renderDexToolsChart();
                    }
                }
            });

            if (this.isLiquidityDeployed()) {
                this.renderDexToolsChart();
            } else {
                this.drawCurve();
                this.setupEventListeners();
            }
            
        } catch (error) {
            console.error('Error initializing bonding curve:', error);
        }
    }

    isLiquidityDeployed() {
        const result = this.state.liquidityPool && 
                      this.state.liquidityPool !== '0x0000000000000000000000000000000000000000';
        return result;
    }

    renderDexToolsChart() {
        const container = this.element.querySelector('.bonding-curve');
        if (!container) {
            return;
        }

        // Clear any existing content
        container.innerHTML = '';

        // Construct the DEXTools URL dynamically
        const networkName = this.getNetworkName(this.state.chainId);
        const chartUrl = `https://www.dextools.io/widget-chart/en/${networkName}/pe-light/${this.state.liquidityPool}?theme=dark&chartType=2&chartResolution=30&drawingToolbars=false`;

        // Use exact DEXTools iframe format from share button
        container.innerHTML = `
            <iframe 
                id="dextools-widget"
                title="$EXEC DEXTools Trading Chart"
                width="100%"
                height="100%"
                src="${chartUrl}"
                style="border: none;"
            ></iframe>
        `;
    }

    getNetworkName(chainId) {
        const networks = {
            1: 'ether',
            5: 'goerli',
            // Add more networks as needed
        };
        return networks[chainId] || 'ether';
    }

    setupEventListeners() {
        // Track which data we've received
        let priceUpdated = false;
        let contractDataUpdated = false;

        // Get initial values from store
        const currentPrice = tradingStore.selectPrice();
        const contractData = tradingStore.selectContractData();
        if (currentPrice) {
            priceUpdated = true;
        }
        if (contractData) {
            contractDataUpdated = true;
        }
        this.checkAndUpdateState(priceUpdated, contractDataUpdated);

        // Set up eventBus subscriptions
        this.unsubscribeEvents = [
            eventBus.on('price:updated', () => {
                priceUpdated = true;
                this.checkAndUpdateState(priceUpdated, contractDataUpdated);
            }),

            eventBus.on('contractData:updated', () => {
                contractDataUpdated = true;
                this.checkAndUpdateState(priceUpdated, contractDataUpdated);
            }),

            eventBus.on('trading:click:tab', () => {
                // Re-check and update state when tab changes
                this.checkAndUpdateState(priceUpdated, contractDataUpdated);
            })
        ];

        // Add resize handler separately
        this.resizeHandler = () => {
            requestAnimationFrame(() => this.drawCurve());
        };
        window.addEventListener('resize', this.resizeHandler);
    }

    checkAndUpdateState(priceUpdated, contractDataUpdated) {
        // Don't update state or draw curve if liquidity is deployed
        if (this.isLiquidityDeployed()) {
            return;
        }

        if (priceUpdated && contractDataUpdated) {
            const currentPrice = tradingStore.selectPrice();
            const { totalBondingSupply, totalMessages, totalNFTs, contractEthBalance } = tradingStore.selectContractData();
            
            this.setState({
                currentPrice,
                totalBondingSupply,
                totalMessages,
                totalNFTs,
                dataReady: true,
                contractEthBalance
            });
            
            // Only redraw curve if we're still in bonding curve mode
            if (!this.isLiquidityDeployed()) {
                this.drawCurve();
            }
        }
    }

    drawCurve() {
        const canvas = this.element.querySelector('#curveChart');
        if (!canvas) {
            console.error('Canvas element not found');
            return;
        }

        const ctx = canvas.getContext('2d');
        
        // Set canvas size
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Always draw the base curve
        this.drawBaseCurve(ctx, canvas);

        // Only draw data-dependent elements if data is ready
        if (this.state.dataReady) {
            this.drawDataElements(ctx);
        } else {
            // Draw placeholder text
            this.drawPlaceholderLabels(ctx);
        }
    }

    drawBaseCurve(ctx, canvas) {
        // Set styles
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 2;

        const curve = (x) => {
            const paddedX = 0.1 + (x * 0.8);
            return Math.pow(paddedX, 3.5);
        }

        const points = this.calculateCurvePoints(canvas, curve);
        this.drawCurvePath(ctx, points);
    }

    drawDataElements(ctx) {
        const curve = (x) => {
            const paddedX = 0.1 + (x * 0.8);
            return Math.pow(paddedX, 3.5);
        }

        const maxPrice = 0.08;
        const currentPosition = Math.max(0.1, Math.min(0.9, 
            Math.pow(this.state.currentPrice.current / maxPrice, 1/3.5)));

        const points = this.calculateCurvePoints(this.element.querySelector('#curveChart'), curve);
        this.drawCurrentPosition(ctx, points, currentPosition);
        this.drawLabels(ctx);
    }

    drawPlaceholderLabels(ctx) {
        ctx.fillStyle = '#666666';
        ctx.font = '12px Courier New';
        ctx.fillText('Loading price data...', 10, 20);
        ctx.fillText('Loading supply data...', 10, 40);
        ctx.fillText('Loading NFT data...', 10, 60);
    }

    calculateCurvePoints(canvas, curve) {
        const points = [];
        const numPoints = 100;
        
        for (let i = 0; i <= numPoints; i++) {
            const x = i / numPoints;
            const y = curve(x);
            
            const canvasX = x * canvas.width * 0.8 + canvas.width * 0.1;
            const canvasY = canvas.height * 0.9 - y * canvas.height * 0.8;
            
            points.push({ x: canvasX, y: canvasY });
        }
        
        return points;
    }

    drawCurvePath(ctx, points) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        
        ctx.stroke();
    }

    drawCurrentPosition(ctx, points, currentPosition) {
        const segmentSize = 0.05;
        const startIndex = Math.floor((currentPosition - segmentSize/2) * points.length);
        const endIndex = Math.floor((currentPosition + segmentSize/2) * points.length);
        
        if (startIndex >= 0 && endIndex < points.length) {
            // Draw highlighted segment
            ctx.beginPath();
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 4;
            
            ctx.moveTo(points[startIndex].x, points[startIndex].y);
            for (let i = startIndex; i <= endIndex; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.stroke();
            
            // Draw indicator dot
            const centerIndex = Math.floor((startIndex + endIndex) / 2);
            const centerPoint = points[centerIndex];
            
            ctx.beginPath();
            ctx.arc(centerPoint.x, centerPoint.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#FF0000';
            ctx.fill();
        }
    }

    drawLabels(ctx) {
        ctx.fillStyle = '#666666';
        ctx.font = '12px Courier New';
        ctx.fillText(`${this.state.currentPrice.current.toFixed(4)} ETH / EXEC`, 10, 20);
        ctx.fillText(`Total Supply: ${this.state.totalBondingSupply.toLocaleString()} EXEC`, 10, 40);
        ctx.fillText(`Total Messages: ${this.state.totalMessages.toLocaleString()}`, 10, 60);
        ctx.fillText(`Total NFTs: ${this.state.totalNFTs.toLocaleString()}`, 10, 80);
        ctx.fillText(`Contract ETH Balance: ${this.state.contractEthBalance}`, 10, 100);
    }

    mount(container) {
        super.mount(container);
        this.initialize();
    }

    unmount() {
        // Clean up event listener
        eventBus.off('contractData:updated');
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        if (this.unsubscribeEvents) {
            this.unsubscribeEvents.forEach(unsubscribe => unsubscribe());
        }
        super.unmount();
    }

    render() {
        return `
            <div class="bonding-curve">
                ${this.isLiquidityDeployed() ? '' : '<canvas id="curveChart"></canvas>'}
            </div>
        `;
    }

    static get styles() {
        return `
            .bonding-curve {
                width: 100%;
                height: 90%;
                min-height: 400px;
                background: #1a1a1a;
                border-radius: 8px;
                padding: 0px;
                overflow: hidden;
                position: relative;
            }

            #curveChart {
                width: 100%;
                height: 100%;
            }

            #dextools-widget {
                width: 100%;
                height: 100%;
                position: absolute;
                top: 0;
                left: 0;
                border: none;
            }
        `;
    }
}

export default BondingCurve;