// just the silly front page phase 1 stuff

// Add this simple performance marker in your code
performance.mark('startApp');

// At key points in your code:
performance.mark('componentLoaded');
performance.measure('componentLoadTime', 'startApp', 'componentLoaded');

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('walletAddress');
    const button = document.getElementById('checkButton');
    const desktopInstructions = document.querySelector('.instructions.desktop');
    const mobileInstructions = document.querySelector('.instructions.mobile');

    // Random number utilities
    let currentCultPrice = 1000;
    let currentEthPrice = 13482.45;
    let currentVolume = 10200000000;
    let currentGasPrice = 0.004;
    let currentOpenPrice = 120.50;
    let currentHighPrice = 123.87;
    let currentLowPrice = 120.15;
    let currentMarketValue = 9.993;

    const randomFluctuation = (base, percentage) => {
        const variance = base * (percentage / 100);
        return base + (Math.random() * variance * 2 - variance);
    };

    const formatNumber = (num, decimals = 2) => {
        return num.toFixed(decimals);
    };

    const formatWithCommas = (num) => {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    };

    // Update functions
    function updatePrice() {
        const priceElement = document.getElementById('currentPrice');
        const changeElement = document.getElementById('priceChange');
        const ethPriceElement = document.getElementById('ethPrice');
        const gasPriceElement = document.getElementById('gasPrice');
        const ethVolumeElement = document.getElementById('ethVolume');
        const openPriceElement = document.getElementById('openPrice');
        const highPriceElement = document.getElementById('highPrice');
        const lowPriceElement = document.getElementById('lowPrice');
        const marketValueElement = document.getElementById('marketValue');
        
        // Guard clause - if any element is missing, return early
        if (!priceElement || !changeElement) {
            console.warn('Some price elements not found in DOM');
            return;
        }
        
        // Update CULT price
        const newCultPrice = randomFluctuation(currentCultPrice, 1);
        const cultChange = newCultPrice - currentCultPrice;
        currentCultPrice = newCultPrice;
        
        priceElement.textContent = formatNumber(currentCultPrice);
        changeElement.textContent = (cultChange >= 0 ? '+' : '') + formatNumber(cultChange);
        
        // Update classes for color
        priceElement.className = 'price ' + (cultChange >= 0 ? 'up' : 'down');
        changeElement.className = 'change ' + (cultChange >= 0 ? 'up' : 'down');
        
        // Update ETH price (always positive change)
        if (ethPriceElement) {
            const newEthPrice = randomFluctuation(currentEthPrice, 0.1);
            const ethChange = Math.abs(newEthPrice - currentEthPrice);
            currentEthPrice = newEthPrice;
            ethPriceElement.textContent = `${formatNumber(currentEthPrice)} +${formatNumber(ethChange)}`;
        }
        
        // Update Gas price
        if (gasPriceElement) {
            const newGasPrice = randomFluctuation(currentGasPrice, 5);
            const gasChange = newGasPrice - currentGasPrice;
            currentGasPrice = newGasPrice;
            // Format gas price with 3 decimal places
            gasPriceElement.textContent = `${currentGasPrice.toFixed(3)} ${gasChange >= 0 ? '+' : ''}${gasChange.toFixed(5)}`;
            gasPriceElement.className = gasChange >= 0 ? 'price-up' : 'price-down';
        }
        
        // Update other price elements
        if (openPriceElement) openPriceElement.textContent = formatNumber(randomFluctuation(currentOpenPrice, 0.1)) + 'P';
        if (highPriceElement) highPriceElement.textContent = formatNumber(randomFluctuation(currentHighPrice, 0.1)) + 'Z';
        if (lowPriceElement) lowPriceElement.textContent = formatNumber(randomFluctuation(currentLowPrice, 0.1)) + 'Q';
        if (marketValueElement) marketValueElement.textContent = formatNumber(randomFluctuation(currentMarketValue, 0.5)) + 'B';
    }

    function updateVolume() {
        const volumeElement = document.getElementById('cult volume');
        if (!volumeElement) {
            console.warn('Volume element not found in DOM');
            return;
        }
        const newVolume = Math.round(randomFluctuation(currentVolume, 2));
        currentVolume = newVolume;
        volumeElement.textContent = (newVolume / 1000000000).toFixed(1) + 'B ETH';
    }

    function updateTime() {
        const timeElement = document.getElementById('timeStamp');
        if (!timeElement) {
            console.warn('Time element not found in DOM');
            return;
        }
        const now = new Date();
        timeElement.textContent = now.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Update all dynamic elements
    function updateAll() {
        updatePrice();
        updateVolume();
        updateTime();
    }

    // Initial update
    updateAll();

    // Update every 0.8 seconds
    setInterval(updateAll, 800);

    // Function to check if device is mobile
    function isMobileDevice() {
        return (
            typeof window.orientation !== "undefined" ||
            navigator.userAgent.indexOf("IEMobile") !== -1 ||
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        );
    }

    // Function to update instructions visibility
    function updateInstructions() {
        const isMobile = isMobileDevice();
        desktopInstructions.style.display = isMobile ? 'none' : 'block';
        mobileInstructions.style.display = isMobile ? 'block' : 'none';
    }

    // Initial check
    updateInstructions();

    // Auto-focus the input field when page loads (only on desktop)
    if (!isMobileDevice()) {
        input.focus();
    }

    // Handle paste and input events
    input.addEventListener('input', () => {
        const address = input.value;
        if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
            input.value = formatAddress(address);
            // Store full address for submission
            input.setAttribute('data-full-address', address);
        }
    });

    // When checking whitelist, use the full address
    async function checkWhitelistStatus() {
        const address = input.getAttribute('data-full-address') || input.value;
        const resultDiv = document.getElementById('result');
        
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            resultDiv.innerHTML = '<p class="error">Please enter a valid Ethereum address</p>';
            return;
        }

        resultDiv.innerHTML = '<p class="checking">Checking...</p>';
        
        const result = await checkWhitelist(address);
        
        if (result) {
            const calendarLinks = generateCalendarLinks(result.date, result.day);
            resultDiv.innerHTML = `
                <p class="success">Congratulations! You are whitelisted!</p>
                <p>Address: ${formatAddress(address)}</p>
                <p>You can participate in the bonding curve presale on Day ${result.day}</p>
            `;
            
            // Clean up the Blob URL when the component is updated
            window.addEventListener('beforeunload', () => {
                URL.revokeObjectURL(calendarLinks.ical);
            });
        } else {
            resultDiv.innerHTML = `
                <p class="error">Address not found in any whitelist</p>
                <p>Address checked: ${formatAddress(address)}</p>
            `;
        }
    }

    // Listen for Enter key
    input.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            checkWhitelistStatus();
        }
    });

    // Button click handler
    button.addEventListener('click', checkWhitelistStatus);
});

// Add these helper functions for calendar integration
function formatDateForICal(dateString) {
    // Convert dates like "February 28th, 2025" to "20250228"
    const date = new Date(dateString.replace(/(st|nd|rd|th)/, ''));
    return date.getFullYear() +
           String(date.getMonth() + 1).padStart(2, '0') +
           String(date.getDate()).padStart(2, '0');
}

function generateCalendarLinks(date, day) {
    // Format date for calendar
    const startDate = formatDateForICal(date);
    
    // Event details
    const eventTitle = `CULTEXEC Mint Day ${day}`;
    const eventDescription = `Your whitelist mint for CULTEXEC - Day ${day}`;
    
    // Generate iCal link
    const iCalData = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        `DTSTART:${startDate}`,
        `SUMMARY:${eventTitle}`,
        `DESCRIPTION:${eventDescription}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\n');
    
    const iCalBlob = new Blob([iCalData], { type: 'text/calendar;charset=utf-8' });
    const iCalUrl = URL.createObjectURL(iCalBlob);
    
    // Generate Google Calendar link
    const googleUrl = new URL('https://calendar.google.com/calendar/render');
    googleUrl.searchParams.append('action', 'TEMPLATE');
    googleUrl.searchParams.append('text', eventTitle);
    googleUrl.searchParams.append('details', eventDescription);
    googleUrl.searchParams.append('dates', `${startDate}/${startDate}`);
    
    return {
        ical: iCalUrl,
        google: googleUrl.toString()
    };
} 

//deprecated

// // Directly include the whitelist data as fallback
// const whitelistData = {
//     '001': {
//         "addresses": [
//             "0x0000000000c5dc95539589fbd24be07c6c14eca4",
//             "0x000000f534caa75bd1a3950ab32d6bd24d2e6b76",
//             "0x01c8dd4691b9cC363585E6CF1Fae5dEEeE662EE9"
//             // ... add more addresses from your 001 list
//         ]
//     },
//     '002': {
//         "addresses": [
//             // ... addresses from your 002 list
//         ]
//     },
//     '003': {
//         "addresses": [
//             // ... addresses from your 003 list
//         ]
//     },
//     '008': {
//         "addresses": [
//             // ... addresses from your 008 list
//         ]
//     },
//     '015': {
//         "addresses": [
//             // ... addresses from your 015 list
//         ]
//     },
//     '029': {
//         "addresses": [
//             // ... addresses from your 029 list
//         ]
//     },
//     '056': {
//         "addresses": [
//             // ... addresses from your 056 list
//         ]
//     }
// };

async function getListData(day) {
    try {
        // Convert day number to two-digit string (1 -> "01")
        const dayString = day.toString().padStart(2, '0');
        
        // Map of known filenames
        const fileMap = {
            '01': '01_cult_1.json',
            '02': '02_fumo.json',
            '03': '03_cult_2.json',
            '04': '04_remixbonkler.json',
            '05': '05_cult_4.json',
            '06': '06_monyms2.json',
            '07': '07_cult_8.json',
            '08': '08_kagamibanners.json',
            '09': '09_cult_15.json',
            '10': '10_milady.json',
            '11': '11_cult_29.json',
            '12': '12_cult_56.json'
        };

        const filename = fileMap[dayString];
        if (!filename) {
            throw new Error(`No file mapping for day ${day}`);
        }

        const response = await fetch(`lists/${filename}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.log(`Fetch failed for day ${day}:`, error);
        throw error; // Remove fallback data since we're using new structure
    }
}

async function checkWhitelist(address) {
    // Normalize the address to lowercase for consistent comparison
    address = address.toLowerCase();
    
    // Define mint dates starting from April 4th
    const mintDates = {
        1: 'April 4th, 2024',
        2: 'April 5th, 2024',
        3: 'April 6th, 2024',
        4: 'April 7th, 2024',
        5: 'April 8th, 2024',
        6: 'April 9th, 2024',
        7: 'April 10th, 2024',
        8: 'April 11th, 2024',
        9: 'April 12th, 2024',
        10: 'April 13th, 2024',
        11: 'April 14th, 2024',
        12: 'April 15th, 2024'
    };

    // Check each day in order
    for (let day = 1; day <= 12; day++) {
        try {
            const data = await getListData(day);
            // Convert all addresses in the list to lowercase for comparison
            const lowercaseAddresses = data.addresses.map(addr => addr.toLowerCase());
            
            if (lowercaseAddresses.includes(address)) {
                return {
                    day: day,
                    date: mintDates[day]
                };
            }
        } catch (error) {
            console.error(`Error checking list for day ${day}:`, error);
        }
    }
    
    return null;
}

// // Add this helper function
function formatAddress(address) {
    if (address.length > 12) {
        // Show 0x + 5 characters, then ..., then last 5 characters
        return address.slice(0, 7) + '...' + address.slice(-5);
    }
    return address;
}