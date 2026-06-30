import { useState } from "react";
import { css } from "@linaria/core";
import { styled } from "@linaria/react";

const page = css`
  min-height: 100vh;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ffe0f0 0%, #e8d6ff 100%);
  font-family: system-ui, sans-serif;
`;

const Card = styled.div`
  padding: 32px 40px;
  border-radius: 24px;
  background: #fff;
  box-shadow: 0 12px 32px rgba(255, 138, 216, 0.35);
  text-align: center;
`;

const Title = styled.h1`
  margin: 0 0 8px;
  font-size: 28px;
  color: #ff6fb5;
`;

const Paw = styled.span`
  font-size: 48px;
  display: inline-block;
  transition: transform 0.2s ease;

  &:hover {
    transform: rotate(-12deg) scale(1.15);
  }
`;

const Button = styled.button<{ happy: boolean }>`
  margin-top: 16px;
  padding: 10px 24px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 16px;
  color: #fff;
  background: ${(props) => (props.happy ? "#ff6fb5" : "#c9a7ff")};
  transition: background 0.2s ease, transform 0.1s ease;

  &:active {
    transform: scale(0.95);
  }
`;

function App() {
  const [count, setCount] = useState(0);

  return (
    <main className={page}>
      <Card>
        <Paw>🐾</Paw>
        <Title>Deskling 猫娘助手</Title>
        <p>主人～Linaria 样式已经生效啦喵！</p>
        <Button happy={count > 0} onClick={() => setCount((c) => c + 1)}>
          摸摸头 ×{count}
        </Button>
      </Card>
    </main>
  );
}

export default App;
