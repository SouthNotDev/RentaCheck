import { Layout, Row, Col, Space, Button, Typography, Divider } from 'antd';
import { PropsWithChildren } from 'react';
import { Link } from 'react-router-dom';

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;

export default function MainLayout({ children }: PropsWithChildren) {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ backgroundColor: '#fff', borderBottom: '1px solid #f0f0f0', padding: '0 24px', height: 64, lineHeight: '64px' }}>
        <Row justify="space-between" align="middle" style={{ height: '100%' }}>
          <Col>
            <div style={{ marginLeft: 24 }}>
              <img src="/logo.png" alt="RentaCheck" style={{ height: 40 }} />
            </div>
          </Col>
          <Col>
            <Space size="large" className="hidden md:flex">
              <Button type="link" href="/#tutoriales">Tutoriales</Button>
              <Button type="link" href="/#precios">Precios</Button>
              <Link to="/contacto">
                <Button type="primary" className="btn-primary" style={{ height: 40 }}>Verificar ahora</Button>
              </Link>
            </Space>
          </Col>
        </Row>
      </Header>
      <Content style={{ padding: '16px 24px' }}>{children}</Content>
      <Footer style={{ textAlign: 'center', backgroundColor: 'var(--bg-accent)' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <img src="/logo.png" alt="RentaCheck Logo" style={{ height: 24 }} />
          </Col>
          <Col>
            <Space size="large">
              <Button type="link" size="small">Términos</Button>
              <Button type="link" size="small">Privacidad</Button>
              <Button type="link" size="small">Soporte</Button>
            </Space>
          </Col>
        </Row>
        <Divider />
        <Text type="secondary" className="text-caption">© 2025 RentaCheck. Análisis tributario inteligente para Colombia.</Text>
      </Footer>
    </Layout>
  );
}


