import { useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import { Row, Col, Card, Button, Typography, Space } from 'antd';
import { AlertTriangle, Clock3, CheckCircle, Lock } from 'lucide-react';
import CompactTestimonials from '../components/ui/compact-testimonials';
import { useFlow } from '../context/FlowContext';
import { parseExogenaExcel } from '../utils/parseExogena';

const { Title, Text, Paragraph } = Typography;

export default function Landing() {
  const navigate = useNavigate();
  const { setUploadedFile, setParsed } = useFlow();
  const fileRef = useRef<HTMLInputElement>(null);

  const onSelectFile = async (file: File) => {
    setUploadedFile(file);
    const parsed = await parseExogenaExcel(file);
    setParsed(parsed);
    navigate('/contacto');
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ height: 48 }} />
      <Row gutter={[32, 32]} align="top">
        {/* Columna izquierda: Héroe */}
        <Col xs={24} md={14}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={18} color="#f59e0b" />
              <Text className="text-caption" style={{ color: 'var(--text-secondary)' }}>Evita sanciones por declarar tarde</Text>
            </div>
            <Title level={1} className="text-hero" style={{ marginTop: 0, fontSize: '2.5rem', lineHeight: 1.1 }}>
              ¿Debes declarar renta?
              <br />
              Verifícalo en 60 segundos.
            </Title>
            <Paragraph className="text-body" style={{ maxWidth: 640 }}>
              Sube tu exógena de la DIAN y nuestro motor de IA te dice si estás obligado a declarar — con una explicación clara y accionable.
            </Paragraph>

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8}>
                <Card size="small" className="card-standard" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <Clock3 size={18} color="var(--brand-secondary)" />
                    <div>
                      <Text className="text-body" style={{ fontWeight: 600 }}>60s resultado</Text>
                      <Text className="text-caption" style={{ display: 'block' }}>Sin esperas ni formularios largos.</Text>
                    </div>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card size="small" className="card-standard" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <CheckCircle size={18} color="var(--brand-secondary)" />
                    <div>
                      <Text className="text-body" style={{ fontWeight: 600 }}>Claro y preciso</Text>
                      <Text className="text-caption" style={{ display: 'block' }}>Sí/No y por qué, con próximos pasos.</Text>
                    </div>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card size="small" className="card-standard" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <Lock size={18} color="var(--brand-secondary)" />
                    <div>
                      <Text className="text-body" style={{ fontWeight: 600 }}>Privado y seguro</Text>
                      <Text className="text-caption" style={{ display: 'block' }}>Tus archivos se procesan de forma segura.</Text>
                    </div>
                  </div>
                </Card>
              </Col>
            </Row>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Button type="primary" size="large" className="btn-primary" onClick={() => navigate('/contacto')}>
                Verificar ahora
              </Button>
            </div>
            {/* Removido: enlace pequeño de Adjuntar exógena (.xlsx) */}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSelectFile(f);
            }} />
          </Space>
        </Col>

        {/* Columna derecha: Precio */}
        <Col xs={24} md={10}>
          <Card className="card-standard" style={{ padding: 24 }}>
            <Text className="text-caption" style={{ display: 'block', marginBottom: 6 }}>Precio único</Text>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <Title level={2} style={{ margin: 0, color: 'var(--text-primary)' }}>$20.000</Title>
              <Text className="text-body">COP</Text>
            </div>
            <Text className="text-caption" style={{ display: 'block', marginTop: 8 }}>Informe inmediato. Sin suscripciones.</Text>

            <Space direction="vertical" size={8} style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <CheckCircle size={16} color="var(--brand-secondary)" />
                <Text className="text-body">Análisis de exógena DIAN con IA</Text>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <CheckCircle size={16} color="var(--brand-secondary)" />
                <Text className="text-body">Recomendación clara y accionable</Text>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <CheckCircle size={16} color="var(--brand-secondary)" />
                <Text className="text-body">Resultado en 60 segundos</Text>
              </div>
            </Space>

            <Button type="primary" size="large" block className="btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/contacto')}>
              Verificar ahora
            </Button>
            <Text className="text-caption" style={{ display: 'block', marginTop: 12 }}>
              No somos la DIAN. Tu información se procesa de forma segura.
            </Text>
          </Card>
        </Col>
      </Row>

      {/* Testimonios: a todo el ancho, sin tarjeta */}
      <div style={{ marginTop: 56 }}>
        <Title level={4} className="text-heading-3" style={{ marginBottom: 8 }}>Lo que dicen nuestros usuarios</Title>
        <div style={{ height: 180, overflow: 'hidden', maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)' }}>
          <CompactTestimonials />
        </div>
      </div>
    </div>
  );
}


