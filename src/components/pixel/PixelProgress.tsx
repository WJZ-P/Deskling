import { styled } from "@linaria/react";
import { PixelFrame } from "./PixelFrame";
import { PX, DITHER_ACCENT } from "./palettes";

interface PixelProgressProps {
  /** 0 ~ 100 */
  value: number;
}

export function PixelProgress({ value }: PixelProgressProps) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <Track>
      <PixelFrame palette={PX.well} variant="sunken" pixel={3} radius={2} />
      <FillWrap>
        <Fill style={{ width: `${v}%` }}>
          <PixelFrame
            palette={PX.accent}
            variant="raised"
            pixel={3}
            radius={1}
            dither={DITHER_ACCENT}
            ditherOpacity={0.4}
          />
        </Fill>
      </FillWrap>
    </Track>
  );
}

const Track = styled.div`
  position: relative;
  width: 100%;
  height: 24px;
  padding: 4px;
`;

const FillWrap = styled.div`
  position: relative;
  z-index: 1;
  height: 100%;
`;

const Fill = styled.div`
  position: relative;
  height: 100%;
  min-width: 10px;
  transition: width 0.25s ease;
`;
