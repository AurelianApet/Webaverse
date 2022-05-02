
import React, { useEffect, useState, useRef } from 'react';
import classnames from 'classnames';
import styles from './spritesheet.module.css';
import spritesheetManager from '../../../../spritesheet-manager.js';

//

export const Spritesheet = ({
    className,
    startUrl,
    enabled,
    size,
    numFrames,
    animated = true,
    background
}) => {

    const [ spritesheet, setSpritesheet ] = useState(null);
    const canvasRef = useRef();

    const numFramesPow2 = Math.pow(2, Math.ceil(Math.log2(numFrames)));
    const numFramesPerRow = Math.ceil(Math.sqrt(numFramesPow2));
    const frameSize = size / numFramesPerRow;
    const frameLoopTime = 2000;
    const frameTime = frameLoopTime / numFrames;

    //

    useEffect(() => {
        if (startUrl) {
            let live = true;
            (async () => {
                const spritesheet = await spritesheetManager.getSpriteSheetForAppUrlAsync(startUrl, {
                    size,
                    numFrames,
                });

                if (!live) {
                    return;
                }
                setSpritesheet(spritesheet);
            })();
            return () => {
              live = false;
            };
        }
    }, [startUrl]);

    useEffect( () => {

        const canvas = canvasRef.current;

        if ( canvas && spritesheet && enabled ) {

            const ctx = canvas.getContext('2d');
            const imageBitmap = spritesheet.result;
            let frameIndex = 0;
            let interval;

            const _recurse = () => {

                const x = (frameIndex % numFramesPerRow) * frameSize;
                const y = size - frameSize - Math.floor(frameIndex / numFramesPerRow) * frameSize;
                frameIndex = (frameIndex + 1) % numFrames;

                if ( background ) {

                    ctx.rect( 0, 0, canvas.width, canvas.height );
                    ctx.fillStyle = background;
                    ctx.fill();

                } else {

                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                }

                ctx.drawImage(imageBitmap, x, y, frameSize, frameSize, 0, 0, canvas.width, canvas.height);

            };

            if ( animated ) {

                setInterval(_recurse, frameTime);

            }

            _recurse();

            //

            return () => {

                if ( animated ) {

                    clearInterval(interval);

                }

            };

        }

    }, [ canvasRef, spritesheet, enabled, animated ] );

    //

    return (
        <canvas
            className={classnames(className, styles.canvas)}
            width={frameSize}
            height={frameSize}
            ref={canvasRef}
        />
    );

};
