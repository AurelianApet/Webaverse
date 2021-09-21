import React, {useState, useEffect, useRef} from 'react';
import classnames from 'classnames';
// import Head from 'next/head'
import {Color} from './Color.js';
// import Image from 'next/image'
import styles from './Header.module.css'
import {world} from '../world.js'
import * as universe from '../universe.js'
import {homeScnUrl} from '../constants.js'

const localColor = new Color();
const localColor2 = new Color();
const localColor3 = new Color();
const localColor4 = new Color();
const localColor5 = new Color();
const localColor6 = new Color();

// console.log('index 1');

export default function Header() {
	// console.log('index 2');
	
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(false);
  const [nfts, setNfts] = useState(null);
  const [roomName, setRoomName] = useState(homeScnUrl);
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  
  const login = async () => {
    if (typeof window.ethereum !== 'undefined') {
      const addresses = await window.ethereum.enable();
      const [address] = addresses;
      // console.log('address', {address});
      setAddress(address);
    } else {
      console.warn('no ethereum');
    }
  };
  
  useEffect(() => {
    const pointerlockchange = e => {
      // console.log('pointer lock change', e);
      if (document.pointerLockElement) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerlockchange', pointerlockchange);
    return () => {
      window.removeEventListener('pointerlockchange', pointerlockchange);
    };
  }, []);
  useEffect(() => {
    if (address && !nfts) {
      setNfts([]);
      
      (async () => {
        const res = await fetch(`https://api.opensea.io/api/v1/assets?owner=${address}&limit=${50}`, {
          headers: {
            'X-API-KEY': `6a7ceb45f3c44c84be65779ad2907046`,
          },
        });
        const j = await res.json();
        const {assets} = j;
        setNfts(assets);
        // console.log('got assets', assets);
      })();
    }
  }, [address, nfts]);
  
	/* const ref = useRef(null);
  const [arrowPosition, _setArrowPosition] = useState(0);
  const [arrowDown, _setArrowDown] = useState(false);
  const [animation, setAnimation] = useState(false);
  const [open, setOpen] = useState(false);
  // const [mouse, setMouse] = useState([0, 0]);
	const [svgData, setSvgData] = useState('');
	const [countdown, setCountdown] = useState(startCountdown);
	const [characterPositions, setCharacterPositions] = useState(null);
	const [appScriptLoaded, setAppScriptLoaded] = useState(false);
	
	const setArrowPosition = n => {
		if (!open && arrowPosition !== n) {
			_setArrowPosition(n);
			const beep = document.getElementById('beep');
			beep.currentTime = 0;
			beep.play();
		}
	};
	const setArrowPosition2 = n => {
		if (!open && arrowPosition !== n) {
			_setArrowPosition(n);
		}
	};
	const setArrowDown = a => {
		_setArrowDown(a);
		if (!open && a) {
			const scillia = document.getElementById('scillia');
			scillia.currentTime = 0;
			scillia.play();
			const boop = document.getElementById('boop');
			boop.currentTime = 0;
			boop.play();
			setAnimation(true);
			setOpen(true);
		}
	};
	useEffect(() => {
		const keydown = e => {
			if (!open) {
				switch (e.which) {
					case 39: { // right
						let n = arrowPosition + 1;
						if (n >= characters.length) {
							n %= characters.length;
						}
						setArrowPosition(n);
						break;
					}
					case 37: { // left
						let n = arrowPosition - 1;
						if (n < 0) {
							n += characters.length;
						}
						setArrowPosition(n);
						break;
					}
					case 13: { // enter
						setArrowDown(true);
						break;
					}
				}
		  } else {
				switch (e.which) {
					case 27: { // escape
					  setAnimation(false);
					  setOpen(false);
					}
				}
			}
		};
		window.addEventListener('keydown', keydown);
		const keyup = e => {
			switch (e.which) {
			  case 13: {
					setArrowDown(false);
				  break;
				}
			}
		};
		window.addEventListener('keyup', keyup);
		return () => {
			window.removeEventListener('keydown', keydown);
		  window.removeEventListener('keyup', keyup);
		};
  }, [arrowPosition, arrowDown, animation, open]);
	useEffect(async () => {
		const res = await fetch('./images/arrow.svg');
		let text = await res.text();
		setSvgData(text);
	}, []);
	useEffect(async () => {
		const lastTimestamp = Date.now();
		const interval = setInterval(() => {
			const now = Date.now();
			const timeDiff = now - lastTimestamp;
			let newCountdown = countdown - timeDiff;
			// console.log('update', countdown, timeDiff, newCountdown);
			if (newCountdown <= 0) {
				newCountdown += startCountdown;
			}
			setCountdown(newCountdown);
		}, 100);
	  return () => {
		  clearInterval(interval);
		};
	}, []);
	useEffect(async () => {
		const onFocus = e => {
		  const audio = document.getElementById('song');
			// console.log('play', audio);
			if (audio.paused) {
			  audio.play();
			}
			// console.log('got audio', audio);
		};
		window.addEventListener('mousedown', onFocus);
		// window.addEventListener('focus', onFocus);
		window.addEventListener('keydown', onFocus);
		return () => {
      window.removeEventListener('mousedown', onFocus);
      // window.removeEventListener('focus', onFocus);
      window.removeEventListener('keydown', onFocus);
		};
	}, []);
	
	const _updateCharacterPositions = () => {
		const characters = Array.from(ref.current.children);
		if (characters.length > 0) {
			const characterPositions = characters.map(c => c.children[0].getBoundingClientRect());
			setCharacterPositions(characterPositions);
		} else {
			setCharacterPositions(null);
		}
	};
	useEffect(_updateCharacterPositions, [ref.current]);
	useEffect(() => {
		window.addEventListener('resize', _updateCharacterPositions);
		return () => {
		  window.removeEventListener('resize', _updateCharacterPositions);
		};
	}, []); */

	return (
    <div className={styles.container} onClick={e => {
      e.stopPropagation();
    }}>
			<div className={styles.inner}>
				<header className={styles.header}>
          <a href="/" className={styles.logo}>
				    <img src="images/arrow-logo.svg" className={styles.image} />
          </a>
					<div className={styles.room}>
            <input type="text" className={styles.input} value={roomName} onChange={e => {
              setRoomName(e.target.value);
            }} onKeyDown={e => {
              console.log('key down', e);
              switch (e.which) {
                case 13: {
                  e.preventDefault();
                  universe.pushUrl(`/?src=${encodeURIComponent(roomName)}`);
                  break;
                }
              }
            }} placeholder="Place to do..." />
            <div className={styles['button-wrap']} onClick={e => {
              setConnected(!connected);
            }}>
              <button className={classnames(styles.button, connected ? null : styles.disabled)}>
                <img src="images/wifi.svg" />
              </button>
            </div>
            <div className={styles['button-wrap']} onClick={async e => {
              await world.enableMic();
              setMicOn(!micOn);
            }}>
              <button className={classnames(styles.button, micOn ? null : styles.disabled)}>
                <img src="images/microphone.svg" className={classnames(styles['mic-on'], micOn ? null : styles.hidden)} />
                <img src="images/microphone-slash.svg" className={classnames(styles['mic-off'], micOn ? styles.hidden : null)} />
              </button>
            </div>
          </div>
					<div className={styles.user} onClick={async e => {
            e.preventDefault();
            e.stopPropagation();

            if (address) {
              setOpen(!open);
            } else {
              await login();
            }
          }}>
					  <img src="images/soul.png" className={styles.icon} />
						<div className={styles.name}>{address || 'Log in'}</div>
					</div>
				</header>
        
        <section className={classnames(styles.sidebar, open ? styles.open : null)} onClick={e => {
          e.preventDefault();
          e.stopPropagation();
        }}>
          {(nfts || []).map((nft, i) => {
            const {id, asset_contract, image_preview_url, image_original_url, name, description} = nft;
            // "https://storage.opensea.io/files/099f7815733ba38b897f892a750e11dc.svg"
            // console.log(nft);
            return <div className={styles.nft} onDragStart={e => {
              e.dataTransfer.setData('application/json', JSON.stringify(nft));
            }} draggable key={i}>
              <img src={image_preview_url} className={styles.preview} />
              <div className={styles.wrap}>
                <div className={styles.name}>{name}</div>
                <div className={styles.description}>{description}</div>
                <div className={styles.tokenid}>{asset_contract.address} / {id}</div>
              </div>
            </div>
          })}
        </section>
      </div>
    </div>
  )
};