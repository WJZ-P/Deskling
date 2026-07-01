import { styled } from "@linaria/react";
import { t } from "../styles/theme";
import {
  Button,
  Page,
  PageHeader,
  PageSubtitle,
  PageTitle,
  Panel,
  PanelTitle,
  SoonTag,
} from "../components/ui";

function Home() {
  return (
    <Page>
      <PageHeader>
        <PageTitle>主页</PageTitle>
        <PageSubtitle>主人好呀～这里是 Deskling 的控制台喵！</PageSubtitle>
      </PageHeader>

      <Panel>
        <PanelTitle>桌宠状态</PanelTitle>
        <PetRow>
          <Paw>🐾</Paw>
          <PetInfo>
            <PetName>Deskling</PetName>
            <PetStatus>待命中 · 随时准备陪主人喵～</PetStatus>
          </PetInfo>
        </PetRow>
      </Panel>

      <Panel>
        <PanelTitle>快捷操作</PanelTitle>
        <Actions>
          <Button type="button" disabled>
            召唤桌宠 <SoonTag>敬请期待</SoonTag>
          </Button>
          <Button type="button" disabled>
            开始对话 <SoonTag>敬请期待</SoonTag>
          </Button>
        </Actions>
      </Panel>
    </Page>
  );
}

export default Home;

const PetRow = styled.div`
  display: flex;
  align-items: center;
  gap: calc(${t.unit} * 4);
`;

const Paw = styled.div`
  font-size: 40px;
  line-height: 1;
`;

const PetInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
`;

const PetName = styled.div`
  font-family: ${t.fontPixel};
  font-size: 16px;
  letter-spacing: 1px;
  color: ${t.colorText};
`;

const PetStatus = styled.div`
  font-size: 12px;
  color: ${t.colorTextMuted};
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: calc(${t.unit} * 2);
`;
